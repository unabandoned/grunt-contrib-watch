/*
 * grunt-contrib-watch
 * http://gruntjs.com/
 *
 * Copyright (c) 2018 "Cowboy" Ben Alman, contributors
 * Licensed under the MIT license.
 */

'use strict';

// A Gaze-compatible file watcher built on chokidar.
//
// Upstream watched through gaze, which (with globule) has been abandoned since
// 2018-2022. This keeps the slice of Gaze's interface the watch task relies on:
//
//   new Watcher(patterns, options, function(err) { this.on('all', ...) })
//   'all' (status, absolutePath) with status 'added' | 'changed' | 'deleted',
//   plus the per-status events and 'error'; watched(); close().
//
// Patterns keep grunt's semantics: they are matched relative to `options.cwd`,
// in order, and a leading `!` excludes. Matching is done by grunt.file.isMatch
// (grunt's own minimatch), so a pattern means exactly what it means anywhere
// else in a Gruntfile. chokidar only sees the static base directory of each
// pattern and skips directories no pattern can reach.

var path = require('path');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var chokidar = null;
function loadChokidar() {
  // chokidar is ESM-only; Node >= 22.12 can require() it synchronously.
  if (!chokidar) {
    chokidar = require('chokidar');
  }
  return chokidar;
}

var GLOB_CHARS = /[*?[\]{}()!+@]/;

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// The leading run of path segments that contain no glob syntax.
function staticBase(pattern) {
  var segments = pattern.split('/');
  var base = [];
  for (var i = 0; i < segments.length; i++) {
    if (GLOB_CHARS.test(segments[i])) {
      return base.join('/') || '.';
    }
    base.push(segments[i]);
  }
  // No glob syntax: a literal file (or directory). Watch its parent so that
  // creating or re-creating it is noticed.
  base.pop();
  if (base.length === 0) {
    return '.';
  }
  return base.join('/') || '/';
}

module.exports = function(grunt) {

  var Minimatch = grunt.file.minimatch.Minimatch;

  function Watcher(patterns, options, done) {
    EventEmitter.call(this);
    var self = this;

    options = options || {};
    if (typeof options === 'function') {
      done = options;
      options = {};
    }

    self.options = options;
    self._cwd = path.resolve(typeof options.cwd === 'string' ? options.cwd : process.cwd());
    self._debounceDelay = typeof options.debounceDelay === 'number' ? options.debounceDelay : 500;
    self._lastEvents = Object.create(null);
    self._matchOptions = {
      dot: options.dot,
      matchBase: options.matchBase,
      nocase: options.nocase
    };

    // Normalise every pattern to a posix path relative to cwd.
    self._patterns = [].concat(patterns || []).filter(function(p) {
      return typeof p === 'string' && p.length > 0;
    }).map(function(p) {
      var negated = p.charAt(0) === '!';
      var body = negated ? p.slice(1) : p;
      if (path.isAbsolute(body)) {
        body = toPosix(path.relative(self._cwd, body)) || '.';
      } else {
        body = body.replace(/\\/g, '/').replace(/^\.\//, '');
      }
      return (negated ? '!' : '') + body;
    });

    var positives = self._patterns.filter(function(p) {
      return p.charAt(0) !== '!';
    });
    self._positiveMatchers = positives.map(function(p) {
      return new Minimatch(p, self._matchOptions);
    });

    var roots = [];
    positives.forEach(function(p) {
      var base = path.resolve(self._cwd, self._matchOptions.matchBase && p.indexOf('/') === -1 ? '.' : staticBase(p));
      if (roots.indexOf(base) === -1) {
        roots.push(base);
      }
    });
    self._roots = roots;

    if (roots.length === 0) {
      process.nextTick(function() {
        if (done) {
          done.call(self, null, self);
        }
      });
      return;
    }

    var usePolling = options.mode === 'poll';
    self._watcher = loadChokidar().watch(roots, {
      ignoreInitial: true,
      persistent: true,
      usePolling: usePolling,
      interval: typeof options.interval === 'number' ? options.interval : 100,
      binaryInterval: typeof options.interval === 'number' ? options.interval : 300,
      ignored: function(filepath) {
        return !self._couldMatch(filepath);
      }
    });

    self._watcher.on('add', function(filepath) {
      self._emit('added', filepath);
    });
    self._watcher.on('addDir', function(filepath) {
      self._emit('added', filepath);
    });
    self._watcher.on('change', function(filepath) {
      self._emit('changed', filepath);
    });
    self._watcher.on('unlink', function(filepath) {
      self._emit('deleted', filepath);
    });
    self._watcher.on('unlinkDir', function(filepath) {
      self._emit('deleted', filepath);
    });
    self._watcher.on('error', function(err) {
      self.emit('error', err);
    });
    self._watcher.once('ready', function() {
      self.emit('ready', self);
      if (done) {
        done.call(self, null, self);
      }
    });
  }
  util.inherits(Watcher, EventEmitter);

  Watcher.prototype._relative = function(filepath) {
    return toPosix(path.relative(this._cwd, path.resolve(this._cwd, filepath)));
  };

  // Whether a path matches the patterns (with exclusions applied).
  Watcher.prototype.isMatch = function(filepath) {
    var rel = this._relative(filepath);
    if (rel === '') {
      return false;
    }
    return grunt.file.isMatch(this._matchOptions, this._patterns, rel);
  };

  // Whether a path matches, or is a directory that something below could
  // match. Used to stop chokidar descending into irrelevant trees.
  Watcher.prototype._couldMatch = function(filepath) {
    var abs = path.resolve(this._cwd, filepath);
    var self = this;
    // Always keep the roots and their ancestors.
    if (self._roots.some(function(root) {
      return root === abs || root.indexOf(abs + path.sep) === 0 || abs === path.parse(abs).root;
    })) {
      return true;
    }
    if (self.isMatch(abs)) {
      return true;
    }
    var rel = self._relative(abs);
    return self._positiveMatchers.some(function(mm) {
      return mm.match(rel, true);
    });
  };

  Watcher.prototype._emit = function(status, filepath) {
    var abs = path.resolve(this._cwd, filepath);
    if (!this.isMatch(abs)) {
      return;
    }

    // Like gaze: drop a repeat of the same event on the same file inside the
    // debounce window.
    var key = status + ':' + abs;
    var now = Date.now();
    if (this._lastEvents[key] && now - this._lastEvents[key] < this._debounceDelay) {
      return;
    }
    this._lastEvents[key] = now;

    this.emit(status, abs);
    this.emit('all', status, abs);
  };

  // Map of watched directory -> watched paths inside it (absolute).
  Watcher.prototype.watched = function() {
    var result = Object.create(null);
    if (!this._watcher) {
      return result;
    }
    var self = this;
    var raw = this._watcher.getWatched();
    Object.keys(raw).forEach(function(dir) {
      var files = raw[dir].map(function(name) {
        return path.join(dir, name);
      }).filter(function(p) {
        return self.isMatch(p);
      });
      if (files.length > 0) {
        result[dir + path.sep] = files;
      }
    });
    return result;
  };

  Watcher.prototype.close = function() {
    var self = this;
    self.removeAllListeners('all');
    var closing = self._watcher ? self._watcher.close() : Promise.resolve();
    self._watcher = null;
    return Promise.resolve(closing).then(function() {
      self.emit('end');
    });
  };

  Watcher.staticBase = staticBase;

  return Watcher;
};
