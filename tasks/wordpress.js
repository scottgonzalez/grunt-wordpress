/*
 * grunt-wordpress
 * https://github.com/scottgonzalez/grunt-wordpress
 *
 * Copyright (c) 2012 Scott González
 * Licensed under the MIT license.
 */

module.exports = function( grunt ) {

require( grunt.task.getFile( "wordpress/posts.js" ) )( grunt );
require( grunt.task.getFile( "wordpress/taxonomies.js" ) )( grunt );
require( grunt.task.getFile( "wordpress/resources.js" ) )( grunt );

var _client,
	path = require( "path" ),
	wordpress = require( "wordpress" ),
	async = grunt.utils.async,
	version = require( "../package" ).version;

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

grunt.registerHelper( "wordpress-validate-xmlrpc-version", function( fn ) {
	var client = grunt.helper( "wordpress-client" );
	grunt.verbose.write( "Verifying XML-RPC version..." );
	client.authenticatedCall( "gw.getVersion", function( error, xmlrpcVersion ) {
		if ( error ) {
			grunt.verbose.error();
			if ( error.code === -32601 ) {
				return fn( new Error(
					"XML-RPC extensions for grunt-wordpress are not installed." ) );
			}

			// XML-RPC is disabled or bad credentials
			// WordPress provides good error messages, so we don't do any special handling
			return fn( error );
		}

		if ( xmlrpcVersion !== version ) {
			return fn( new Error( "Mismatching versions. " +
				"grunt-wordpress: " + version + "; XML-RPC version: " + xmlrpcVersion ) );
		}

		grunt.verbose.ok();
		fn( null );
	});
});

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
		dir = grunt.config( "wordpress.dir" );

	// TODO:
	// - Verify that jQuery Slugs plugin exists (should really merge into gw)

	async.waterfall([
		function( fn ) {
			grunt.helper( "wordpress-validate-xmlrpc-version", fn );
		},

		function( fn ) {
			grunt.helper( "wordpress-validate-terms", path.join( dir, "taxonomies.json" ), fn );
		},

		function( fn ) {
			grunt.helper( "wordpress-validate-posts", path.join( dir, "posts/" ), fn );
		}
	], function( error ) {
		if ( error ) {
			grunt.log.error( error );
			return done( false );
		}

		done();
	});
});

grunt.registerTask( "wordpress-publish", "wordpress-validate wordpress-sync" );
grunt.registerTask( "wordpress-deploy", "build-wordpress wordpress-publish" );

};
