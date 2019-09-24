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

import * as path from 'path';
import ts from 'typescript';
import {SourceFileConverter} from './source-file-converter.js';
import {OverlayLanguageServiceHost} from './overlay-language-service-host.js';

const compilerOptions = {
  target: ts.ScriptTarget.ES2017,
  module: ts.ModuleKind.ESNext,
  experimentalDecorators: true,
  skipDefaultLibCheck: true,
  skipLibCheck: true,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
};

/* TODO(justinfagnani): Pick a better name */
export class Grimlock {
  languageServiceHost: OverlayLanguageServiceHost;
  languageService: ts.LanguageService;

  constructor(packageRoot: string) {
    this.languageServiceHost = new OverlayLanguageServiceHost(
      packageRoot,
      compilerOptions
    );
    this.languageService = ts.createLanguageService(
      this.languageServiceHost,
      ts.createDocumentRegistry()
    );
  }

  convertModule(
    fileName: string,
    source: string,
    definedElements?: {[tagName: string]: string}
  ) {
    const testPath = path.resolve(__dirname, fileName);
    const existingFile = this.languageServiceHost.files.get(testPath);
    const version = existingFile === undefined ? 0 : existingFile.version + 1;
    this.languageServiceHost.files.clear();
    this.languageServiceHost.files.set(testPath, {version, source});

    const program = this.languageService.getProgram()!;
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(testPath)!;

    const diagnostics = program.getSyntacticDiagnostics(sourceFile);
    if (diagnostics.length > 0) {
      console.error(
        diagnostics.map((d) => `${d.file.fileName}: ${d.messageText}`)
      );
      throw new Error('syntax errors in test input');
    }

    const definedElementsMap =
      definedElements && new Map(Object.entries(definedElements));
    const converter = new SourceFileConverter(
      sourceFile,
      checker,
      __dirname,
      definedElementsMap
    );
    const ast = converter.convertFile();

    return {
      ast,
      get output() {
        let output = '';
        for (const s of ast.emit()) {
          output += s;
        }
        return output.trim();
      },
      diagnostics: converter.diagnostics,
      converter,
    };
  }
}
