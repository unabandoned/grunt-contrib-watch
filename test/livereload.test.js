'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var http = require('http');
var grunt = require('grunt');
var WebSocket = require('ws');
var helper = require('./helper');

var cwd = path.resolve(helper.fixtures, 'livereload');

function request(port, reqPath) {
  return new Promise(function(resolve, reject) {
    http.get({hostname: 'localhost', port: port, path: reqPath || '/'}, function(res) {
      var data = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) {
        data += chunk;
      });
      res.on('end', function() {
        resolve({res: res, body: data});
      });
    }).on('error', reject);
  });
}

function editOne() {
  grunt.file.write(path.join(cwd, 'lib', 'one.js'), 'var one = true;');
}

// Request the server's welcome, then edit lib/one.js.
function welcomeThenEdit(port, holder) {
  return function() {
    request(port).then(function(r) {
      holder.welcome = JSON.parse(r.body);
      editOne();
    });
  };
}

test('basic', async function() {
  var h = {};
  var r = await helper.runTask(['watch:basic', '-v'], {cwd: cwd}, welcomeThenEdit(35729, h));
  var out = helper.unixify(r.stdout);
  assert.ok(out.indexOf('I ran before livereload.') !== -1);
  assert.ok(out.indexOf('Live reload server started on *:35729') !== -1);
  assert.ok(out.indexOf('Live reloading lib/one.js...') !== -1);
  assert.equal(h.welcome.tinylr, 'Welcome');
});

test('customhost', async function() {
  var h = {};
  var r = await helper.runTask(['watch:customhost', '-v'], {cwd: cwd}, welcomeThenEdit(8675, h));
  var out = helper.unixify(r.stdout);
  assert.ok(out.indexOf('I ran before livereload.') !== -1);
  assert.ok(out.indexOf('Live reload server started on localhost:8675') !== -1);
  assert.ok(out.indexOf('Live reloading lib/one.js...') !== -1);
  assert.equal(h.welcome.tinylr, 'Welcome');
});

test('differentfiles', async function() {
  var r = await helper.runTask(['watch:differentfiles', '-v'], {cwd: cwd}, [editOne, function() {
    grunt.file.write(path.join(cwd, 'lib', 'two.js'), 'var two = true;');
  }]);
  var out = helper.unixify(r.stdout);
  assert.ok(out.indexOf('Live reloading lib/one.js...') !== -1);
  assert.ok(out.indexOf('Live reloading lib/two.js...') !== -1);
  assert.ok(!/Live reloading (lib\/one\.js, lib\/two.js|lib\/two.js, lib\/one.js)\.\.\./.test(out));
});

test('multiplefiles', async function() {
  var h = {};
  var r = await helper.runTask(['watch:multiplefiles', '-v'], {cwd: cwd}, function() {
    request(9876).then(function(res) {
      h.welcome = JSON.parse(res.body);
      editOne();
      grunt.file.write(path.join(cwd, 'lib', 'two.js'), 'var two = true;');
    });
  });
  var out = helper.unixify(r.stdout);
  assert.ok(out.indexOf('I ran before livereload.') !== -1);
  assert.ok(out.indexOf('Live reload server started on *:9876') !== -1);
  assert.ok(/Live reloading (lib\/one\.js, lib\/two.js|lib\/two.js, lib\/one.js)\.\.\./.test(out));
  assert.equal(h.welcome.tinylr, 'Welcome');
});

test('nospawn', async function() {
  var h = {};
  var r = await helper.runTask(['watch:nospawn', '-v'], {cwd: cwd}, welcomeThenEdit(1337, h));
  var out = helper.unixify(r.stdout);
  assert.ok(out.indexOf('I ran before livereload.') !== -1);
  assert.ok(out.indexOf('Live reload server started on *:1337') !== -1);
  assert.ok(out.indexOf('Live reloading lib/one.js...') !== -1);
  assert.equal(h.welcome.tinylr, 'Welcome');
});

test('notasks', async function() {
  var h = {};
  var r = await helper.runTask(['watch:notasks', '-v'], {cwd: cwd}, welcomeThenEdit(35729, h));
  var out = helper.unixify(r.stdout);
  assert.ok(out.indexOf('Live reload server started on *:35729') !== -1);
  assert.ok(out.indexOf('Live reloading lib/one.js...') !== -1);
  assert.equal(h.welcome.tinylr, 'Welcome');
});

test('onlytriggeron', async function() {
  var r = await helper.runTask(['watch', '-v'], {cwd: cwd}, function() {
    request(35729).then(function() {
      grunt.file.write(path.join(cwd, 'sass', 'one.scss'), '#one {}');
    });
  });
  var out = helper.unixify(r.stdout);
  assert.ok(out.indexOf('Live reloading sass/one.scss') === -1);
  assert.ok(out.indexOf('Live reloading css/one.css') !== -1);
});

test('livereloadOnError defaults to true', async function() {
  var r = await helper.runTask(['watch:livereloadOnErrorTrue', '-v'], {cwd: cwd}, welcomeThenEdit(35729, {}));
  assert.ok(helper.unixify(r.stdout).indexOf('Live reloading lib/one.js...') !== -1);
});

test('livereloadOnError: false', async function() {
  var r = await helper.runTask(['watch:livereloadOnErrorFalse', '-v'], {cwd: cwd}, welcomeThenEdit(35729, {}));
  assert.ok(helper.unixify(r.stdout).indexOf('Live reloading lib/one.js...') === -1);
});

test('livereloadOnError: false with spawn: false', async function() {
  var r = await helper.runTask(['watch:livereloadOnErrorFalseNoSpawn', '-v'], {cwd: cwd}, welcomeThenEdit(35729, {}));
  assert.ok(helper.unixify(r.stdout).indexOf('Live reloading lib/one.js...') === -1);
});

test('browsers get the client script and a reload message over the protocol', async function() {
  var h = {messages: []};
  var r = await helper.runTask(['watch:basic', '-v'], {cwd: cwd, killAfter: 2500}, function() {
    request(35729, '/livereload.js').then(function(res) {
      h.script = res;
      var ws = new WebSocket('ws://localhost:35729/livereload');
      ws.on('open', function() {
        ws.send(JSON.stringify({command: 'hello', protocols: ['http://livereload.com/protocols/official-7']}));
      });
      ws.on('message', function(data) {
        var msg = JSON.parse(String(data));
        h.messages.push(msg);
        if (msg.command === 'hello') {
          editOne();
        } else {
          ws.close();
        }
      });
    });
  });
  helper.verboseLog(r.stdout);
  assert.equal(h.script.res.statusCode, 200);
  assert.match(h.script.res.headers['content-type'], /javascript/);
  assert.ok(h.script.body.length > 1000, 'should serve livereload-js');
  assert.equal(h.messages[0].command, 'hello');
  var reload = h.messages.find(function(m) {
    return m.command === 'reload';
  });
  assert.ok(reload, 'should have sent a reload command');
  assert.equal(reload.path, 'lib/one.js');
});
