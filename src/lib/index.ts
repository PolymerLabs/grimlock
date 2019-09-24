/**
 * @license
 * Copyright (c) 2019 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import * as fs from 'fs';
import * as path from 'path';
import {Grimlock} from './grimlock.js';
import {SourceFileGenerator} from './source-file-generator.js';

const packageRoot = path.resolve(__dirname, '../');

const main = () => {
  const [inFile] = process.argv.slice(2);
  if (
    inFile === undefined ||
    !inFile.endsWith('.ts')
  ) {
    console.error(`Usage: grimlock input.ts`);
    process.exitCode = 1;
    return;
  }
  const grimlock = new Grimlock(packageRoot, [SourceFileGenerator]);
  const input = fs.readFileSync(inFile, 'utf8');
  const outputFiles = grimlock.convertModule(inFile, input).files;
  for (const file of outputFiles) {
    const outputFilePath = path.relative(__dirname, file.filename);
    fs.writeFileSync(outputFilePath, file.content, 'utf8');
  }
};

if (require.main === module) {
  main();
}
