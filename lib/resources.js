module.exports = function( Client ) {

var fs = require( "fs" );
var path = require( "path" );
var async = require( "async" );

// support: node <0.8
var existsSync = fs.existsSync || path.existsSync;

Client.prototype.getResources = function( callback ) {
	if ( this.verbose ) {
		this.log( "Getting resources from WordPress..." );
	}

	this.client.call( "gw.getResources", function( error, resources ) {
		if ( error ) {
			return callback( error );
		}

		if ( this.verbose ) {
			this.log( "Got resources from WordPress." );
		}

		callback( null, resources );
	}.bind( this ));
};

Client.prototype.publishResource = function( filepath, content, callback ) {
	if ( this.verbose ) {
		this.log( "Publishing " + filepath + "..." );
	}

	this.client.authenticatedCall( "gw.addResource", filepath, content, function( error, checksum ) {
		if ( error ) {
			return callback( error );
		}

		this.log( "Published " + filepath + "." );

		callback( null, checksum );
	}.bind( this ));
};

Client.prototype.deleteResource = function( filepath, callback ) {
	if ( this.verbose ) {
		this.log( "Deleting " + filepath + "..." );
	}

	this.client.authenticatedCall( "gw.deleteResource", filepath, function( error, checksum ) {
		if ( error ) {
			return callback( error );
		}

		if ( this.verbose ) {
			this.log( "Deleted " + filepath + "." );
		}

		callback( null, checksum );
	}.bind( this ));
};

Client.prototype.syncResources = function( dir, callback ) {
	if ( this.verbose ) {
		this.log( "Synchronizing resources..." );
	}

	// Check if there are any resources to process
	if ( !existsSync( dir ) ) {
		if ( this.verbose ) {
			this.log( "No resources to process." );
		}

		return callback( null );
	}

	async.waterfall([
		function getResources( callback ) {
			this.getResources( callback );
		}.bind( this ),

		function publishResources( resources, callback ) {
			if ( this.verbose ) {
				this.log( "Publishing resources..." );
			}

			Client.recurse( dir, function( file, callback ) {
				var resource = file.substr( dir.length, file.length - dir.length );
				var content = fs.readFileSync( file, { encoding: "base64" } );
				var checksum = Client.createChecksum( content );

				// Already exists, no need to update
				if ( resource in resources && checksum === resources[ resource ] ) {
					if ( this.verbose ) {
						this.log( "Skipping " + resource + "; already up-to-date." );
					}

					delete resources[ resource ];
					return callback( null );
				}

				this.publishResource( resource, content, function( error ) {
					if ( error ) {
						return callback( error );
					}

					delete resources[ resource ];
					callback( null );
				});
			}.bind( this ), function( error ) {
				if ( error ) {
					return callback( error );
				}

				if ( this.verbose ) {
					this.log( "Published all resources." );
				}

				callback( null, resources );
			}.bind( this ));
		}.bind( this ),

		function deleteResources( resources, callback ) {
			if ( this.verbose ) {
				this.log( "Deleting old resources..." );
			}

			async.forEachSeries( Object.keys( resources ), function( resourcePath, callback ) {
				this.deleteResource( resourcePath, callback );
			}.bind( this ), function( error ) {
				if ( error ) {
					return callback( error );
				}

				if ( this.verbose ) {
					this.log( "Deleted all old resources." );
				}

				callback( null );
			}.bind( this ));
		}.bind( this )
	], callback );
};

};
