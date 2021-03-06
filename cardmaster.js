const glob = require('glob');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const Handlebars = require('handlebars');
const watch = require('watch');
const YAML = require('yaml')

const perPage = 9;
const templateFile = 'template';
const appDir = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;

Handlebars.registerHelper('text', function(text) {
  text = Handlebars.Utils.escapeExpression(text);
  text = text.replace(/\\n/gm, '<br>');
  return new Handlebars.SafeString(text);
});

async function dataFiles(dir) {
  const csvFiles = await new Promise((resolve, reject) => {
    glob(dir + '/**.csv', {}, (er, files) => {
      resolve(files);
    });
  });
  const yamlFiles = await new Promise((resolve, reject) => {
    glob(dir + '/**.y*ml', {}, (er, files) => {
      resolve(files);
    });
  });
  return csvFiles.concat(yamlFiles);
}

async function processDataFile(file, perPage) {
  return new Promise((resolve, reject) => {
    const ret = [];
    let page = [];

    if(file.endsWith('csv')) {
      fs.createReadStream(file)
        .pipe(csv())
        .on('data', (data) => {
          for (let i = 0; i < data.copies; i++) {
            if (page.length === perPage) {
              ret.push(page);
              page = [];
            }
            page.push(data);
          }
        })
        .on('end', () => {
          if (page.length > 0) {
            ret.push(page);
          }
          resolve(ret);
        });
    } else {
      const data = YAML.parse(fs.readFileSync(file, 'utf8'));
      if (data !== null && typeof data[Symbol.iterator] === 'function') {
        for (let entry of data) {
          for (let i = 0; i < entry.copies; i++) {
            if (page.length === perPage) {
              ret.push(page);
              page = [];
            }
            page.push(entry);
          }
          if (page.length > 0) {
            ret.push(page);
          }
        }
      }
      resolve(ret);
    }
  });
}

function renderHtml(templateFile, data, targetFile) {
  const template = Handlebars.compile(fs.readFileSync(templateFile).toString('utf8'));
  const ret = template(data);
  fs.writeFileSync(targetFile, ret);
}

async function main(dataDir) {
  const files = await dataFiles(dataDir);
  const data = [];


  try {
    for (const file of files) {
      console.log('Processing file: ' + file);
      const pages = await processDataFile(file, perPage);
      if (pages.length === 0) {
        console.log(' No items found, skipping');
        continue;
      }
      const name = path.parse(file)
        .name
        .replace(/_/, ' ');
      data.push({
        name: name,
        pages: pages
      })
    }
    console.log('Rendering html file');
    renderHtml(path.resolve(appDir, 'template', templateFile + '.handlebars'), {itemSets: data}, path.resolve(dataDir, 'cards.html'));
    console.log('Copy style');
    fs.copyFileSync(path.resolve(appDir, 'template', templateFile + '.css'), dataDir + '/' + templateFile + '.css');
  } catch (err) {
    console.error(err);
    console.log('Rendering error html file');
    renderHtml(path.resolve(appDir, 'template', 'error.handlebars'), {error: err.toString()}, path.resolve(dataDir, 'cards.html'));
  }

  console.log('DONE');
}

(async () => {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    throw Error('Missing data dir argument');
  }
  const dataDir = args[0];
  console.log('Data dir: ' + dataDir);
  if (!fs.existsSync(dataDir)) {
    throw Error('Data dir isn\'t existing');
  }

  await main(dataDir);

  console.log('Waiting for file changes...');

  watch.watchTree(dataDir, {
    filter: (file) => {
      return /\.csv|\.ya?ml$/.test(file);
    }
  },async (f, curr, prev) => {
    if (typeof f == "object" && prev === null && curr === null) {
      // Finished walking the tree
    } else {
      console.log(' ' + f + ' changed');
      await main(dataDir);
      console.log('Waiting for file changes...');
    }
  });

  watch.watchTree(path.resolve(appDir, 'template'), {
    filter: (file) => {
      return /\.(?:css|handlebars)$/.test(file);
    }
  },async (f, curr, prev) => {
    if (typeof f == "object" && prev === null && curr === null) {
      // Finished walking the tree
    } else {
      console.log(' Template ' + f + ' changed');
      await main(dataDir);
      console.log('Waiting for file changes...');
    }
  });

})();
