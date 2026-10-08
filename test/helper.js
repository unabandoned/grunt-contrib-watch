'use strict';

var path = require('path');
var spawn = require('child_process').spawn;
var grunt = require('grunt');

var helper = module.exports = {};

// Where the fixtures are
helper.fixtures = path.join(__dirname, 'fixtures');

// The grunt bin these tests drive
helper.gruntBin = require.resolve('grunt/bin/grunt');

helper.verbose = process.env.WATCH_TEST_VERBOSE === '1';
helper.verboseLog = function() {
  if (helper.verbose) {
    console.log.apply(console, arguments);
  }
};

// Spawn `grunt <task>` in a fixture. Every time `trigger` appears on stdout
// the next function in `runs` is called; after the last one the child is sent
// SIGINT. Resolves with {stdout, stderr}.
helper.runTask = function runTask(task, options, runs) {
  options = options || {};
  var trigger = options.trigger === undefined ? 'Waiting' : options.trigger;
  var cwd = options.cwd || process.cwd();
  var delay = options.delay || 800;
  var args = [helper.gruntBin].concat(task);

  if (typeof runs === 'function') {
    runs = [runs];
  }
  runs = (runs || []).slice();
  runs.push(function(child) {
    setTimeout(function() {
      child.kill('SIGINT');
    }, options.killAfter || 1500);
  });

  return new Promise(function(resolve, reject) {
    var child = spawn(process.execPath, args, {cwd: cwd});
    var out = '';
    var err = '';
    var timeout = setTimeout(function() {
      child.kill('SIGKILL');
    }, options.timeout || 30000);

    child.stdout.on('data', function(data) {
      data = grunt.log.uncolor(String(data));
      out += data;
      var shouldRun = trigger === false || new RegExp(trigger, 'm').test(data);
      if (shouldRun) {
        setTimeout(function() {
          var run = runs.shift();
          if (typeof run === 'function') {
            run(child);
          }
        }, delay);
      }
    });
    child.stderr.on('data', function(data) {
      err += String(data);
    });
    child.on('error', reject);
    child.on('exit', function() {
      clearTimeout(timeout);
      helper.verboseLog(out);
      resolve({stdout: out, stderr: err});
    });
  });
};

// Clean up files within fixtures
helper.cleanUp = function cleanUp(files) {
  [].concat(files).forEach(function(filepath) {
    filepath = path.join(helper.fixtures, filepath);
    if (grunt.file.exists(filepath)) {
      grunt.file.delete(filepath);
    }
  });
};

// Helper for testing cross platform
helper.unixify = function(str) {
  return str.replace(/\\/g, '/').replace(/\r\n|\n/g, '\n');
};

helper.count = function(str, sub) {
  return str.split(sub).length - 1;
};
