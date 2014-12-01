module.exports = function( grunt ) {

grunt.loadNpmTasks( "grunt-contrib-jshint" );

grunt.initConfig({
	jshint: {
		options: {
			jshintrc: true
		},
		all: [ "Gruntfile.js", "tasks/**/*.js" ]
	}
});

grunt.registerTask( "default", "jshint" );

};
