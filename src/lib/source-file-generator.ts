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

import {Generator, OutputFile} from './generator.js';
import {SourceFileConverter} from './source-file-converter.js';
import ts from 'typescript';

export const SourceFileGenerator: Generator = (
  sourceFile: ts.SourceFile,
  program: ts.Program,
  languageServiceHost: ts.LanguageServiceHost,
  rootDir: string,
) => {
  const converter = new SourceFileConverter(
    sourceFile,
    program,
    languageServiceHost,
    rootDir
  );
  const ast = converter.convertFile();

  const outputFilename = sourceFile.fileName.replace('.ts', '.soy');
  // Currently, SourceFileGenerator generates a single file.
  const outputFile: OutputFile = {
    get content() {
      let output = '';
      for (const s of ast.emit()) {
        output += s;
      }
      return output.trim();
    },
    filename: outputFilename
  }

  return {
    files: [outputFile],
    diagnostics: converter.diagnostics
  };
}