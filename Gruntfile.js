module.exports = function( grunt ) {

grunt.loadNpmTasks( "grunt-contrib-jshint" );

grunt.initConfig({
	jshint: {
		options: {
			jshintrc: true
		},
		src: [ "index.js", "lib/**/*.js" ],
		build: [ "Gruntfile.js", "tasks/**/*.js" ]
	}
});

grunt.registerTask( "default", "jshint" );

};
