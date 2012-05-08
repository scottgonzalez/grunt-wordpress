/*
 * grunt-wordpress
 * https://github.com/scottgonzalez/grunt-wordpress
 *
 * Copyright (c) 2012 Scott González
 * Licensed under the MIT license.
 */

module.exports = function( grunt ) {

// TODO: support for static resources (requires new XML-RPC method)

require( grunt.task.getFile( "wordpress/posts.js" ) )( grunt );
require( grunt.task.getFile( "wordpress/taxonomies.js" ) )( grunt );
require( grunt.task.getFile( "wordpress/resources.js" ) )( grunt );

var _client,
	path = require( "path" ),
	wordpress = require( "wordpress" ),
	async = grunt.utils.async;

// Async directory recursion, always walks all files before recursing
grunt.registerHelper( "wordpress-recurse", function recurse( rootdir, fn, complete ) {
	var path = rootdir + "/*";
	async.mapSeries( grunt.file.expandFiles( path ), fn, function( error ) {
		if ( error ) {
			return complete( error );
		}

		async.map( grunt.file.expandDirs( path ), function( dir, dirComplete ) {
			recurse( dir, fn, dirComplete );
		}, complete );
	});
});

grunt.registerHelper( "wordpress-client", function() {
	if ( !_client ) {
		_client = wordpress.createClient( grunt.config( "wordpress" ) );
	}
	return _client;
});

// TODO: Smarter updates (compare checksums and only republish if there were changes)
grunt.registerTask( "wordpress-sync", "Synchronize WordPress with local content", function() {
	this.requires( "wordpress-validate" );

	var done = this.async(),
		dir = grunt.config( "wordpress.dir" );

	async.waterfall([
		function syncTerms( fn ) {
			grunt.helper( "wordpress-sync-terms", path.join( dir, "taxonomies.json" ), fn );
		},

		function syncPosts( termMap, fn ) {
			grunt.helper( "wordpress-sync-posts", path.join( dir, "posts/" ), termMap, fn );
		},

		function syncResources( fn ) {
			grunt.helper( "wordpress-sync-resources", path.join( dir, "resources/" ), fn );
		}
	], function( error ) {
		if ( !error ) {
			return done();
		}

		if ( error.code === "ECONNREFUSED" ) {
			grunt.log.error( "Could not connect to WordPress XML-RPC server." );
		} else {
			grunt.log.error( error );
		}

		done( false );
	});
});

grunt.registerTask( "wordpress-validate", "Validate HTML files for synchronizing WordPress", function() {
	var done = this.async(),
		dir = grunt.config( "wordpress.dir" ),
		count = 0;

	// TODO:
	// - Verify that all child posts actually have parents
	//    - All directories must have a matching file
	// - Verify that all files have .html extension
	// - Verify required metadata
	//    - Title, anything else?
	// - Verify gw.getPostPaths exists
	// - Verify that jQuery Slugs plugin exists
	// - Verify taxonomies.json
	//    - Requires name, slug
	//    - Slug must be [a-z0-9.-], no consecutive dashes
	//    - Check for existing terms with same name, but different slug

	grunt.helper( "wordpress-walk-posts", path.join( dir, "posts/" ), function( post, fn ) {
		count++;
		fn( null );
	}, function( error ) {
		if ( error ) {
			grunt.log.error( error );
			return done( false );
		}

		grunt.log.writeln( "Validated " + count + " files." );
		done();
	});
});

grunt.registerTask( "wordpress-publish", "wordpress-validate wordpress-sync" );
grunt.registerTask( "wordpress-deploy", "build-wordpress wordpress-publish" );

};
