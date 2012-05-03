# grunt-wordpress

Grunt plugin for publishing content to WordPress

## Getting Started
Install this grunt plugin next to your project's [grunt.js gruntfile][getting_started] with: `npm install grunt-wordpress`

Then add this line to your project's `grunt.js` gruntfile:

```javascript
grunt.loadNpmTasks( "grunt-wordpress" );
```

## API

For most projects, you should only need to specify the `wordpress` config
and use the `wordpress-deploy` task.

### Config

```javascript
grunt.initConfig({
	wordpress: {
		url: "wordpress.dev",
		username: "admin",
		password: "admin",
		src: "dist"
	}
});
```

* `url`: The URL for the WordPress install.
  Can be a full URL, e.g., `http://wordpress.dev:123/some/path`
  or as short as just the host name.
  If the protocol is `https`, then a secure connection will be used.
* `username`: WordPress username.
* `password`: WordPress password.
* `src`: Directory containing posts, taxonomies, and resources (see [Directory Structure](#directory-structure)).

### Directory Structure

The `wordpress.src` directory has the following structure:

```
src
├── posts
│   └── <post_type>
│       └── <post_name>.html
├── resources
│   └── <file>.<ext>
└── taxonomies.json
```

The `posts` directory must only contain `<post_type>` directories.
The `<post_type>` directories must be named to exactly match a post type, e.g., `post` or `page`.
All custom post types are supported.

The `resources` directory is completely freeform.
Resources of any type will be uploaded based on the current directory structure.

*Note: resources are not implemented yet.*

The `taxonomies.json` file defines all used taxonomy terms.
You can only manage terms, all taxonomies much already exist in WordPress.

```json
{
	"<taxonomy_name>": [
		{
			"name": "My Term",
			"description": "My term is awesome",
			"slug": "my-term"
		},
		{
			"name": "My Other Term",
			"slug": "my-other-term",
			"children": [
				{
					"name": "I'm a child term!",
					"slug": "hooray-for-children"
				}
			]
		}
	]
}
```

### Tasks

#### wordpress-validate

Walks through the `wordpress.src` directory and performs various validations, such as:

* Verifying that XML-RPC is enabled for the WordPress site.
* Verifying that the custom XML-RPC methods for grunt-wordpress are installed.
* Verifying the taxonomies in `taxonomies.json`.
* Verifying that child-parent relationships for posts are valid.
* Verifying metadata for each post.

*Note: most of the validation is not implemented yet.*

#### wordpress-publish

Syncs everything in `wordpress.src` to the WordPress site.
This will create/edit/delete taxonomies, posts, and resources.

*Note: `wordpress-validate` must run prior to `wordpress-publish`.*

#### wordpress-deploy

Alias task for `build`, `wordpress-validate`, `wordpress-publish`.
This task exists for simplifying the deployment process.
Simply create a `build` task that populates the `wordpress.src` directory
and your deployments will be as simple as `grunt wordpress-deploy`.

### Helpers

#### wordpress-walk-posts( dir, walkFn, complete )

Walks through all posts in `dir` (asynchronous and in series).

* `dir`: The directory to walk through, e.g., `wordpress.src`.
* `walkFn` (`function( post, callback )`): Callback to invoke for each post.
  * `post`: An object containing the post content and metadata.
  * `callback`: A callback to invoke after processing the post.
  Passing an error will stop the helper.
* `complete` (`function( error )`): Callback to invoke after walking all posts.

[getting_started]: https://github.com/cowboy/grunt/blob/master/docs/getting_started.md

## License
Copyright 2012 Scott González
Licensed under the MIT license.
