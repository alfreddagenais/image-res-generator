#!/usr/bin / env node
/* eslint-disable no-console */
'use strict';

// libs init
const program = require('commander');
const Q = require('bluebird');
const fs = require('fs-extra');
const colors = require('colors')
const path = require('path');
const _ = require('lodash');
const sharp = require('sharp');
const Gauge = require('gauge');
const packageJSON = require('./package.json');

const IMAGE_FORMATS = ['svg', 'webp', 'png', 'tif', 'tiff', 'dzi', 'szi', 'v', 'vips', 'jpg', 'jpeg'];

function isSupportedFormat(aFileName) {
  let vExt = path.extname(aFileName);
  if (vExt && vExt.length >= 2) {
    vExt = vExt.slice(1).toLowerCase();
    return IMAGE_FORMATS.indexOf(vExt) !== -1;
  }
}

// helpers
const display = {
  info: (str) => {
    console.log(str);
  },
  success: (str) => {
    str = ' ' + colors.green('✓') + ' ' + str;
    console.log(str);
  },
  error: (str) => {
    str = ' ' + colors.red('✗') + ' ' + str;
    console.log(str);
  },
  header: (str) => {
    console.log('');
    console.log(str);
  }
};

// app main variables and constants
var PLATFORMS = {
  'android': {
    definitions: ['./platforms/icons/android', './platforms/splash/android']
  },
  'ios': {
    definitions: ['./platforms/icons/ios', './platforms/splash/ios']
  },
  'windows': {
    definitions: ['./platforms/icons/windows', './platforms/splash/windows']
  },
  'blackberry10': {
    definitions: ['./platforms/icons/blackberry10']
  }
};
var g_imageObjects;
var g_selectedPlatforms = [];

// app functions
function getValidFileName(aFileName) {
  var result;
  var ext = path.extname(aFileName);
  if (ext.length > 1) {
    if (!isSupportedFormat(aFileName)) {
      throw new Error(aFileName + ' is not supported image format!');
    }
    if (fs.existsSync(path.resolve(aFileName))) result = aFileName;
  } else {
    if (ext.length === 1) aFileName = aFileName.slice(0, aFileName.length - 2);
    for (let i = 0; i < IMAGE_FORMATS.length; i++) {
      if (fs.existsSync(path.resolve(aFileName + '.' + IMAGE_FORMATS[i]))) {
        result = aFileName + '.' + IMAGE_FORMATS[i];
        break;
      }
    }
  }
  if (!result) throw new Error(aFileName + ' no such file.');
  return result;
}

function check(settings) {
  display.header('Checking files and directories');

  var vFile;
  try {
    vFile = getValidFileName(settings.iconFile);
    settings.iconFile = vFile;

    vFile = getValidFileName(settings.splashFile);
    settings.splashFile = vFile;
  } catch (err) {
    catchErrors(err);
  }

  return updatePlatforms(settings)
    .then(() => checkPlatforms(settings))
    .then((selPlatforms) => g_selectedPlatforms = selPlatforms)
    .then(() => getImages(settings))
    .then((imageObjects) => {
      g_imageObjects = imageObjects;
    })
    .then(() => checkOutPutDir(settings));
}

function updatePlatforms(settings) {
  if (settings.configPath) {
    for (var platform in PLATFORMS) {
      var iconConfig = PLATFORMS[platform].definitions[0];
      if (iconConfig) {
        PLATFORMS[platform].definitions[0] = iconConfig.replace('./platforms', settings.configPath);
      }

      var splashConfig = PLATFORMS[platform].definitions[1];
      if (splashConfig) {
        PLATFORMS[platform].definitions[1] = splashConfig.replace('./platforms', settings.configPath);
      }
    }
  }
  return Q.resolve(settings);
}

function checkPlatforms(settings) {
  var platformsKeys = _.keys(PLATFORMS);

  if (!settings.platforms || !Array.isArray(settings.platforms)) {
    display.success('Processing files for all platforms');
    return Q.resolve(platformsKeys);
  }

  var platforms = settings.platforms;
  var platformsToProcess = [];
  var platformsUnknown = [];

  platforms.forEach(platform => {

    if (_.find(platformsKeys, (p) => platform === p)) {
      platformsToProcess.push(platform);
    } else {
      platformsUnknown.push(platform);
    }
  });

  if (platformsUnknown.length > 0) {
    display.error('Bad platforms: ' + platformsUnknown);
    return Q.reject('Bad platforms: ' + platformsUnknown);
  }

  display.success('Processing files for: ' + platformsToProcess);
  return Q.resolve(platformsToProcess);
}

function getImages(settings) {
  var imageObjects = {
    icon: null,
    splash: null
  };

  var promise = Q.resolve();

  if (settings.makeIcon) {
    promise = promise.then(() => checkIconFile(settings.iconFile))
      .then((image) => {
        imageObjects.icon = image;
      });
  }
  if (settings.makeSplash) {
    promise = promise.then(() => checkSplashFile(settings.splashFile))
      .then((image) => {
        imageObjects.splash = image;
      });
  }

  return promise.then(() => {
    return imageObjects;
  });

  function checkIconFile(iconFileName) {
    const result = sharp(iconFileName);
    return result.metadata()
      .then((image) => {
        if (image.width === image.height && (image.format === 'svg' || image.width >= 1024)) {
          result.__meta = image;
          display.success('Icon file ok (' + image.width + 'x' + image.height + ')');
        } else {
          display.error('Bad icon file (' + image.width + 'x' + image.height + ')');
          throw new Error('Bad image format');
        }
        return result;
      })
  }

  function checkSplashFile(splashFileName) {
    const result = sharp(splashFileName);
    return result.metadata()
      .then((image) => {
        if (image.width === image.height && (image.format === 'svg' || image.width >= 2732)) {
          result.__meta = image;
          display.success('splash file ok (' + image.width + 'x' + image.height + ')');
        } else {
          display.error('Bad splash file (' + image.width + 'x' + image.height + ')');
          throw new Error('Bad image format');
        }
        return result;
      })
  }
}

function checkOutPutDir(settings) {
  var dir = settings.outputDirectory;

  return fs.pathExists(dir)
    .then((exists) => {
      if (exists) {
        display.success('Output directory ok (' + dir + ')');
      } else {
        display.error('Output directory not found (' + dir + ')');
        throw ('Output directory not found: ' + dir);
      }
    });
}

function generateForConfig(imageObj, settings, config) {
  // console.log('[generateForConfig] ',  JSON.stringify(settings, null, 2), JSON.stringify(config, null, 2));
  var platformPath = path.join(settings.outputDirectory, config.path);

  var transformIcon = (definition) => {
    var image = imageObj.icon;

    var outputFilePath = path.join(platformPath, definition.name);
    var outDir = path.dirname(outputFilePath);
    return fs.ensureDir(outDir).then(() => {
      return image.resize(definition.size, definition.size)
        .toFile(outputFilePath);
    })
  };

  var transformSplash = (definition) => {
    var image = imageObj.splash;
    var width = definition.width;
    var height = definition.height;
    var outputFilePath = path.join(platformPath, definition.name);
    var outDir = path.dirname(outputFilePath);

    return fs.ensureDir(outDir).then(() => {
      return image.resize(width, height)
        .crop(sharp.strategy.entropy)
        .toFile(outputFilePath)
    })
  };

  return fs.ensureDir(platformPath)
    .then(() => {
      var definitions = config.definitions;
      var sectionName = 'Generating ' + config.type + ' files for ' + config.platform;
      var definitionCount = definitions.length;
      var progressIndex = 0;

      var gauge = new Gauge();
      gauge.show(sectionName, 0);

      return Q.mapSeries(definitions, (def) => {
        var transformPromise = Q.resolve();
        transformPromise = transformPromise.then(() => {
          progressIndex++;
          var progressRate = progressIndex / definitionCount;
          gauge.show(sectionName, progressRate);
          gauge.pulse(def.name);
        });
        switch (config.type) {
          case 'icon':
            transformPromise = transformPromise.then(() => transformIcon(def));
            break;
          case 'splash':
            transformPromise = transformPromise.then(() => transformSplash(def));
            break;
        }
        return transformPromise;
      }).then(() => {
        gauge.disable();
        display.success('Generated ' + config.type + ' files for ' + config.platform);
      }).catch((err) => {
        gauge.disable();
        throw (err);
      });
    });
}

function generate(imageObj, settings) {

  display.header('Generating files');
  var configs = [];
  g_selectedPlatforms.forEach((platform) => {
    PLATFORMS[platform].definitions.forEach((platformDef) => configs.push(require(platformDef)));
  });

  var filteredConfigs = _.filter(configs, (config) => {
    if (config.type === 'icon' && settings.makeIcon) {
      return true;
    }
    if (config.type === 'splash' && settings.makeSplash) {
      return true;
    }
    return false;
  });

  return Q.mapSeries(filteredConfigs, (config) => {
    return generateForConfig(imageObj, settings, config);
  })
    .then(() => {
      //display.success("Successfully generated all files");
    });

}

function catchErrors(err) {
  if (err) {
    console.log('Error: ', err.message);
    process.exit(1);
  }
}

// cli helper configuration
function processList(val) {
  return val.split(',');
}

program
  .version(packageJSON.version)
  .description(packageJSON.description)
  .option('-i, --icon [optional]', 'optional icon file path (default: ./resources/icon)')
  .option('-s, --splash [optional]', 'optional splash file path (default: ./resources/splash)')
  .option('-p, --platforms [optional]', 'optional platform token comma separated list (default: all platforms processed)', processList)
  .option('-o, --outputDir [optional]', 'optional output directory (default: ./resources/)')
  .option('-I, --makeIcon [optional]', 'option to process icon files only')
  .option('-S, --makeSplash [optional]', 'option to process splash files only')
  .option('--configPath [optional]', 'option to change the default config path (default: ./platforms)')
  .parse(process.argv);

// app settings and default values

var g_settings = {
  iconFile: program.icon || path.join('.', 'resources', 'icon'),
  splashFile: program.splash || path.join('.', 'resources', 'splash'),
  platforms: program.platforms || undefined,
  outputDirectory: program.outputDir || path.join('.', 'resources'),
  makeIcon: program.makeIcon || (!program.makeIcon && !program.makeSplash) ? true : false,
  makeSplash: program.makeSplash || (!program.makeIcon && !program.makeSplash) ? true : false,
  configPath: program.configPath || undefined,
};

// app entry point

console.log('***************************');
console.log("cordova-res-generator " + packageJSON.version);
console.log("***************************");

check(g_settings)
  .then(() => generate(g_imageObjects, g_settings))
  .catch((err) => catchErrors(err));
