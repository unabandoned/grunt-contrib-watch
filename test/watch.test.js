'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var grunt = require('grunt');
var helper = require('./helper');

var fixtures = helper.fixtures;

function write(cwd, file, content) {
  grunt.file.write(path.join(cwd, file), content);
}

test('atBegin runs the tasks once before any change', async function() {
  var cwd = path.resolve(fixtures, 'atBegin');
  var r = await helper.runTask(['watch', '--debug'], {cwd: cwd}, function() {});
  assert.ok(r.stdout.indexOf('one has changed') !== -1, 'watch should have fired without a change');
});

test('dateFormat option replaces the completion line', async function() {
  var cwd = path.resolve(fixtures, 'dateFormat');
  var r = await helper.runTask(['watch', '--debug'], {cwd: cwd}, function() {
    write(cwd, 'lib/one.js', 'var one = true;');
  });
  assert.ok(r.stdout.indexOf('dateFormat has worked!') !== -1);
});

test('oneTarget: non-target config with templated files', async function() {
  var cwd = path.resolve(fixtures, 'oneTarget');
  var r = await helper.runTask(['watch', '--debug'], {cwd: cwd}, function() {
    write(cwd, 'lib/one.js', 'var test = true;');
  });
  assert.ok(r.stdout.indexOf('File "lib' + path.sep + 'one.js" changed') !== -1);
  assert.ok(r.stdout.indexOf('I do absolutely nothing.') !== -1, 'echo task should have fired');
});

test('multiTargets: a change triggers only its own target', async function() {
  var cwd = path.resolve(fixtures, 'multiTargets');
  var r = await helper.runTask('watch', {cwd: cwd}, function() {
    write(cwd, 'lib/one.js', 'var test = true;');
  });
  assert.ok(r.stdout.indexOf('one has changed') !== -1);
  assert.ok(r.stdout.indexOf('two has changed') === -1);
});

test('multiTargets: sequential changes trigger both', async function() {
  var cwd = path.resolve(fixtures, 'multiTargets');
  var r = await helper.runTask('watch', {cwd: cwd}, [function() {
    write(cwd, 'lib/one.js', 'var test = true;');
  }, function() {
    write(cwd, 'lib/two.js', 'var test = true;');
  }]);
  assert.ok(r.stdout.indexOf('one has changed') !== -1);
  assert.ok(r.stdout.indexOf('two has changed') !== -1);
});

test('multiTargets: simultaneous changes trigger both', async function() {
  var cwd = path.resolve(fixtures, 'multiTargets');
  var r = await helper.runTask('watch', {cwd: cwd}, function() {
    write(cwd, 'lib/one.js', 'var test = true;');
    write(cwd, 'lib/two.js', 'var test = true;');
  });
  assert.ok(r.stdout.indexOf('one has changed') !== -1);
  assert.ok(r.stdout.indexOf('two has changed') !== -1);
});

test('spawns one run at a time', async function() {
  var cwd = path.resolve(fixtures, 'multiTargets');
  var r = await helper.runTask('watch', {cwd: cwd, killAfter: 3000}, function() {
    write(cwd, 'lib/wait.js', 'var wait = false;');
    setTimeout(function() {
      write(cwd, 'lib/wait.js', 'var wait = true;');
    }, 500);
  });
  assert.ok(r.stdout.indexOf('I waited 2s') !== -1);
});

test('interrupt: true restarts a running spawn', async function() {
  var cwd = path.resolve(fixtures, 'multiTargets');
  var spawn = require('child_process').spawn;
  var output = [];
  await new Promise(function(resolve) {
    var child = spawn(process.execPath, [helper.gruntBin, 'watch'], {cwd: cwd});
    var started = false;
    child.stdout.on('data', function(data) {
      data = grunt.log.uncolor(String(data));
      output.push(data);
      if (data.indexOf('I want to be interrupted') !== -1) {
        setTimeout(function() {
          child.kill('SIGINT');
        }, 500);
      } else if (!started && data.indexOf('Waiting...') !== -1) {
        started = true;
        setTimeout(function() {
          write(cwd, 'lib/interrupt.js', 'var interrupt = 1;');
          setTimeout(function() {
            write(cwd, 'lib/interrupt.js', 'var interrupt = 2;');
          }, 1000);
          setTimeout(function() {
            write(cwd, 'lib/interrupt.js', 'var interrupt = 3;');
          }, 2000);
        }, 1000);
      }
    });
    child.on('exit', resolve);
  });
  var result = output.join('\n');
  helper.verboseLog(result);
  assert.equal(helper.count(result, 'have been interrupted'), 2, 'should have been interrupted twice');
  assert.equal(helper.count(result, 'I want to be interrupted'), 1, 'only the last run should complete');
});

test('a failing spawned task does not stop the watch', async function() {
  var cwd = path.resolve(fixtures, 'multiTargets');
  var r = await helper.runTask('watch', {cwd: cwd, killAfter: 2500}, function() {
    write(cwd, 'lib/fail.js', 'var fail = false;');
  });
  assert.ok(r.stdout.toLowerCase().indexOf('fatal') !== -1, 'task should have been fatal');
  assert.equal(helper.count(r.stdout, 'Waiting...'), 2);
});

test('cwd option: {files, spawn}', async function() {
  var cwd = path.resolve(fixtures, 'multiTargets');
  var r = await helper.runTask('watch:cwd', {cwd: cwd}, function() {
    write(cwd, 'lib/one.js', 'var test = true;');
  });
  assert.ok(r.stdout.toLowerCase().indexOf('cwd works') !== -1);
  assert.equal(helper.count(r.stdout, 'Waiting...'), 2);
});

test('reloads itself when the Gruntfile changes', async function() {
  var cwd = path.resolve(fixtures, 'multiTargets');
  var gruntfile = path.join(cwd, 'Gruntfile.js');
  var backup = grunt.file.read(gruntfile);
  try {
    var r = await helper.runTask('watch', {cwd: cwd}, [function() {
      write(cwd, 'lib/one.js', 'var one = true;');
    }, function() {
      grunt.file.write(gruntfile, backup.replace('echo:one', 'echo:two'));
    }, function() {
      write(cwd, 'lib/one.js', 'var one = true;');
    }]);
    assert.equal(helper.count(r.stdout, 'Running "watch" task'), 2, 'watch should have started twice');
    assert.ok(r.stdout.indexOf('one has changed') !== -1);
    assert.ok(r.stdout.indexOf('two has changed') !== -1);
  } finally {
    grunt.file.write(gruntfile, backup);
  }
});

test('negated patterns exclude files', async function() {
  var cwd = path.resolve(fixtures, 'patterns');
  var r = await helper.runTask('watch:negate', {cwd: cwd, killAfter: 4500}, function() {
    write(cwd, 'lib/sub/dontedit.js', 'var dontedit = true;');
    setTimeout(function() {
      write(cwd, 'lib/edit.js', 'var edit = true;');
    }, 3000);
  });
  assert.ok(r.stdout.indexOf('File "lib' + path.sep + 'edit.js" changed') !== -1);
  assert.ok(r.stdout.indexOf('dontedit.js" changed') === -1);
});

test('watching the CyberChef shape: dir/** with a negated file', async function() {
  var cwd = path.resolve(fixtures, 'patterns');
  var r = await helper.runTask('watch:cyberchef', {cwd: cwd, killAfter: 2500}, function() {
    write(cwd, 'lib/sub/index.mjs', 'export default 1;');
    setTimeout(function() {
      write(cwd, 'lib/sub/Op.mjs', 'export default 2;');
    }, 1000);
  });
  assert.ok(r.stdout.indexOf('File "lib' + path.sep + 'sub' + path.sep + 'Op.mjs" changed') !== -1);
  assert.ok(r.stdout.indexOf('index.mjs" changed') === -1, 'the negated file must not trigger');
  assert.ok(r.stdout.indexOf('echo task has ran.') !== -1, 'the spawned task should run');
});

test('no warnings on stderr', async function() {
  var cwd = path.resolve(fixtures, 'oneTarget');
  var r = await helper.runTask('watch', {cwd: cwd}, function() {
    write(cwd, 'lib/one.js', 'var test = true;');
  });
  assert.equal(r.stderr, '');
});
