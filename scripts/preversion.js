#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const definedVersion = process.env.npm_package_dependencies_gilded_wordpress
const gildedPath = require.resolve('gilded-wordpress/gilded-wordpress.php')
const gruntPath = path.join(__dirname, '../gilded-wordpress.php')
const gildedSource = fs.readFileSync(gildedPath, 'utf8')
const gruntSource = fs.readFileSync(gruntPath, 'utf8')

const [ , version] = /GW_VERSION', '([^']+)'/.exec(gruntSource)

if (version !== definedVersion) {
  console.error(
    `Mismatched versions:
    gilded-wordpress.php: ${version}
    gilded-wordpress in package.json: ${definedVersion}`
  )
  process.exitCode = 1
  return
}

if (gruntSource !== gildedSource) {
  fs.writeFileSync(gruntPath, gildedSource)
  console.error(
    'gilded-wordpress.php is not in sync with the dependency.\n' +
    'The file has been updated automatically.\n' +
    'Please commit the change and restart the release.'
  )
  process.exitCode = 1
  return
}
