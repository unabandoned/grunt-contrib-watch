/*
 * grunt-contrib-watch
 * http://gruntjs.com/
 *
 * Copyright (c) 2018 "Cowboy" Ben Alman, contributors
 * Licensed under the MIT license.
 */

'use strict';

// A small LiveReload protocol server, replacing tiny-lr (abandoned since 2020,
// and carrying faye-websocket, body, debug, qs and an old livereload-js).
//
// It keeps the parts of tiny-lr's surface that clients and tooling rely on:
//
//   GET  /                     -> {"tinylr":"Welcome","version":...}
//   GET  /livereload.js        -> the livereload-js client
//   GET|POST /changed?files=a,b  (or a JSON body {"files": [...]}) -> reload
//   GET  /kill                 -> close the server
//   WS   /livereload           -> LiveReload protocol 7 (hello / reload)
//
// and the constructor options tiny-lr accepted from the watch task: port,
// host, key/cert (HTTPS) and livereload (path to a custom client script).

var fs = require('fs');
var http = require('http');
var https = require('https');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var WebSocketServer = require('ws').WebSocketServer;

var pkg = require('../../package.json');

var PROTOCOL = 'http://livereload.com/protocols/official-7';

function clientScriptPath(options) {
  if (options.livereload) {
    return options.livereload;
  }
  return require.resolve('livereload-js/dist/livereload.js');
}

function Server(options) {
  EventEmitter.call(this);
  var self = this;

  options = options || {};
  self.options = options;
  self.port = options.port;
  self.clients = new Set();

  var handler = function(req, res) {
    self.handle(req, res);
  };
  self.server = (options.key && options.cert) ?
    https.createServer({key: options.key, cert: options.cert}, handler) :
    http.createServer(handler);

  self.wss = new WebSocketServer({noServer: true});
  self.server.on('upgrade', function(req, socket, head) {
    var pathname = (req.url || '').split('?')[0];
    if (pathname !== '/livereload' && pathname !== '/') {
      socket.destroy();
      return;
    }
    self.wss.handleUpgrade(req, socket, head, function(ws) {
      self._connection(ws);
    });
  });
}
util.inherits(Server, EventEmitter);

Server.prototype._connection = function(ws) {
  var self = this;
  self.clients.add(ws);
  ws.on('message', function(data) {
    var msg;
    try {
      msg = JSON.parse(String(data));
    } catch (e) {
      return;
    }
    if (msg && msg.command === 'hello') {
      ws.send(JSON.stringify({
        command: 'hello',
        protocols: [PROTOCOL],
        serverName: 'grunt-contrib-watch'
      }));
    }
  });
  ws.on('close', function() {
    self.clients.delete(ws);
  });
  ws.on('error', function() {
    self.clients.delete(ws);
  });
};

Server.prototype.listen = function(port, host, done) {
  var self = this;
  if (typeof host === 'function') {
    done = host;
    host = undefined;
  }
  self.port = port;
  self.server.listen(port, host, function() {
    if (done) {
      done();
    }
  });
};

Server.prototype.close = function(done) {
  this.clients.forEach(function(ws) {
    ws.terminate();
  });
  this.clients.clear();
  this.wss.close();
  if (this.server.closeAllConnections) {
    this.server.closeAllConnections();
  }
  this.server.close(done);
};

// Notify connected browsers that files changed. Accepts tiny-lr's call shape,
// changed({body: {files: [...]}}), or a plain array of paths.
Server.prototype.changed = function(params) {
  var files = Array.isArray(params) ? params : ((params && params.body && params.body.files) || []);
  if (typeof files === 'string') {
    files = files.split(/[\s,]+/).filter(Boolean);
  }
  var self = this;
  files.forEach(function(file) {
    var message = JSON.stringify({
      command: 'reload',
      path: file,
      liveCSS: self.options.liveCSS !== false,
      liveImg: self.options.liveImg !== false
    });
    self.clients.forEach(function(ws) {
      if (ws.readyState === 1) {
        ws.send(message);
      }
    });
  });
  this.emit('changed', files);
  return files;
};

function sendJSON(res, status, body) {
  var json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json)
  });
  res.end(json);
}

Server.prototype.handle = function(req, res) {
  var self = this;
  var url = new URL(req.url || '/', 'http://localhost');
  var pathname = url.pathname;

  if (pathname === '/livereload.js') {
    fs.readFile(clientScriptPath(self.options), function(err, data) {
      if (err) {
        res.writeHead(500);
        res.end(err.message);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Content-Length': data.length
      });
      res.end(data);
    });
    return;
  }

  if (pathname === '/changed') {
    var chunks = [];
    req.on('data', function(chunk) {
      chunks.push(chunk);
    });
    req.on('end', function() {
      var files = url.searchParams.get('files');
      files = files ? files.split(/[\s,]+/).filter(Boolean) : [];
      if (chunks.length > 0) {
        try {
          var body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (body && body.files) {
            files = files.concat(body.files);
          }
        } catch (e) {
          sendJSON(res, 400, {error: 'invalid_json', reason: 'Bad Request'});
          return;
        }
      }
      self.changed(files);
      sendJSON(res, 200, {clients: Array.from(self.clients).map(function(ws, i) {
        return {id: i};
      }), files: files});
    });
    return;
  }

  if (pathname === '/kill') {
    sendJSON(res, 200, {});
    self.close();
    return;
  }

  if (pathname === '/') {
    sendJSON(res, 200, {tinylr: 'Welcome', version: pkg.version});
    return;
  }

  sendJSON(res, 404, {error: 'not_found', reason: 'no such route'});
};

module.exports = function createServer(options) {
  return new Server(options);
};
module.exports.Server = Server;
module.exports.scriptPath = clientScriptPath;
