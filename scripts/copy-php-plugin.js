#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const package = require('../package');

const definedVersion = package.dependencies['gilded-wordpress'];
const gildedPath = require.resolve('gilded-wordpress/gilded-wordpress.php')
const gruntPath = path.join(__dirname, '../gilded-wordpress.php')
const gildedSource = fs.readFileSync(gildedPath, 'utf8')

const [ , version] = /GW_VERSION', '([^']+)'/.exec(gildedSource)

if (version !== definedVersion) {
  console.error(
    'The gilded-wordpress dependency is out of date.\n' +
    'Please run `npm install` to install the correct version.'
  )
  process.exitCode = 1
  return
}

fs.writeFileSync(gruntPath, gildedSource)
