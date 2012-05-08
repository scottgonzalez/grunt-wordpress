module.exports = function( grunt ) {

var path = require( "path" ),
	crypto = require( "crypto" ),
	async = grunt.utils.async;

function createChecksum( str ) {
	var md5 = crypto.createHash( "md5" );
	md5.update( str, "utf8" );
	return md5.digest( "hex" );
}

grunt.registerHelper( "wordpress-get-resources", function( fn ) {
	var client = grunt.helper( "wordpress-client" );
	grunt.verbose.write( "Getting resources from WordPress..." );
	client.call( "gw.getResources", function( error, resources ) {
		if ( error ) {
			grunt.verbose.error();
			grunt.verbose.or.error( "Error getting resources from WordPress." );
			return fn( error );
		}

		grunt.verbose.ok();
		grunt.verbose.writeln();
		fn( null, resources );
	});
});

grunt.registerHelper( "wordpress-publish-resource", function( filepath, content, fn ) {
	var client = grunt.helper( "wordpress-client" );

	grunt.verbose.write( "Publishing " + filepath + "..." );
	client.authenticatedCall( "gw.addResource", filepath, content, function( error, checksum ) {
		if ( error ) {
			grunt.verbose.error();
			grunt.verbose.or.error( "Error publishing " + filepath + "." );
			return fn( error );
		}

		grunt.verbose.ok();
		grunt.verbose.or.writeln( "Published " + filepath + "." );
		fn( null, checksum );
	});
});

grunt.registerHelper( "wordpress-delete-resource", function( filepath, fn ) {
	var client = grunt.helper( "wordpress-client" );

	grunt.verbose.write( "Deleting " + filepath + "..." );
	client.authenticatedCall( "gw.deleteResource", filepath, function( error, checksum ) {
		if ( error ) {
			grunt.verbose.error();
			grunt.verbose.or.error( "Error deleting " + filepath + "." );
			return fn( error );
		}

		grunt.verbose.ok();
		fn( null, checksum );
	});
});

grunt.registerHelper( "wordpress-sync-resources", function( dir, fn ) {
	grunt.verbose.writeln( "Synchronizing resources.".bold );

	// Check if there are any resources to process
	if ( !path.existsSync( dir ) ) {
		grunt.verbose.writeln( "No resources to process." );
		grunt.verbose.writeln();
		return fn( null );
	}

	async.waterfall([
		function getResources( fn ) {
			grunt.helper( "wordpress-get-resources", fn );
		},

		function publishResources( resources, fn ) {
			grunt.verbose.writeln( "Processing resources.".bold );
			grunt.helper( "wordpress-recurse", dir, function( file, fn ) {
				var resource = file.substr( dir.length, file.length - dir.length ),
					content = grunt.file.read( file, "base64" ).toString( "base64" ),
					checksum = createChecksum( content );

				// Already exists, no need to update
				if ( resource in resources && checksum === resources[ resource ] ) {
					grunt.verbose.writeln( "Skiping " + resource + "; already up-to-date." );
					delete resources[ resource ];
					return fn( null );
				}

				grunt.helper( "wordpress-publish-resource", resource, content, function( error ) {
					if ( error ) {
						return fn( error );
					}

					delete resources[ resource ];
					fn( null );
				});
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				grunt.verbose.writeln();
				fn( null, resources );
			});
		},

		function deleteResources( resources, fn ) {
			grunt.verbose.writeln( "Deleting old resources.".bold );
			async.forEachSeries( Object.keys( resources ), function( resourcePath, fn ) {
				grunt.helper( "wordpress-delete-resource", resourcePath, fn );
			}, function( error ) {
				if ( error ) {
					return fn( error );
				}

				grunt.verbose.writeln();
				fn( null );
			});
		}
	], fn );
});

};
