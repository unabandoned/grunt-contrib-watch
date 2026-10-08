/*
 * grunt-contrib-watch
 * http://gruntjs.com/
 *
 * Copyright (c) 2018 "Cowboy" Ben Alman, contributors
 * Licensed under the MIT license.
 */

'use strict';

// Dogfood: `npx grunt watch` re-runs the test suite on every source change.
module.exports = function(grunt) {
  grunt.initConfig({
    watch: {
      all: {
        files: ['Gruntfile.js', 'tasks/**/*.js', 'test/*.js'],
        tasks: ['test']
      }
    }
  });

  grunt.loadTasks('tasks');

  grunt.registerTask('test', 'Run the node:test suite.', function() {
    var done = this.async();
    grunt.util.spawn({cmd: 'npm', args: ['test'], opts: {stdio: 'inherit'}}, function(err) {
      done(!err);
    });
  });

  grunt.registerTask('default', ['test']);
};
