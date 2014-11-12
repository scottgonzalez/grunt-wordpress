module.exports = function( Client ) {

var fs = require( "fs" );

Client.prototype.getResources = function( callback ) {
	callback = callback.bind( this );

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
	});
};

Client.prototype.publishResource = function( filepath, content, callback ) {
	callback = callback.bind( this );

	if ( this.verbose ) {
		this.log( "Publishing " + filepath + "..." );
	}

	this.client.authenticatedCall( "gw.addResource", filepath, content, function( error, checksum ) {
		if ( error ) {
			return callback( error );
		}

		this.log( "Published " + filepath + "." );

		callback( null, checksum );
	});
};

Client.prototype.deleteResource = function( filepath, callback ) {
	callback = callback.bind( this );

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
	});
};

Client.prototype.syncResources = function( dir, callback ) {
	callback = callback.bind( this );

	if ( this.verbose ) {
		this.log( "Synchronizing resources..." );
	}

	this.waterfall([
		function getResources( callback ) {
			this.getResources( callback );
		},

		function publishResources( resources, callback ) {
			if ( this.verbose ) {
				this.log( "Publishing resources..." );
			}

			this.recurse( dir, function( file, callback ) {
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
			}, function( error ) {
				if ( error ) {
					return callback( error );
				}

				if ( this.verbose ) {
					this.log( "Published all resources." );
				}

				callback( null, resources );
			});
		},

		function deleteResources( resources, callback ) {
			if ( this.verbose ) {
				this.log( "Deleting old resources..." );
			}

			this.forEach( Object.keys( resources ), function( resourcePath, callback ) {
				this.deleteResource( resourcePath, callback );
			}, function( error ) {
				if ( error ) {
					return callback( error );
				}

				if ( this.verbose ) {
					this.log( "Deleted all old resources." );
				}

				callback( null );
			});
		}
	], callback );
};

};
