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
import {OverlayLanguageServiceHost} from './overlay-language-service-host.js';
import {Generator, OutputFile, Diagnostic} from './generator.js';

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
  generators: Generator[];
  languageServiceHost: OverlayLanguageServiceHost;
  languageService: ts.LanguageService;

  constructor(packageRoot: string, generators: Generator[]) {
    this.generators = generators;
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
  ): {files: OutputFile[], diagnostics: Diagnostic[]} {
    const testPath = path.resolve(__dirname, fileName);
    const existingFile = this.languageServiceHost.files.get(testPath);
    const version = existingFile === undefined ? 0 : existingFile.version + 1;
    this.languageServiceHost.files.clear();
    this.languageServiceHost.files.set(testPath, {version, source});

    const program = this.languageService.getProgram()!;
    const sourceFile = program.getSourceFile(testPath)!;

    const diagnostics = program.getSyntacticDiagnostics(sourceFile);
    if (diagnostics.length > 0) {
      console.error(
        diagnostics.map((d) => `${d.file.fileName}: ${d.messageText}`)
      );
      throw new Error('syntax errors in test input');
    }

    let output = this.generators.map((generator) => generator(sourceFile, program, this.languageServiceHost, __dirname));
    // Flatten output files and diagnostics from different generators into
    // single arrays.
    let outputFiles = output.map((o) => o.files).reduce((last, cur) => last.concat(cur));
    let outputDiagnostics = output.map((o) => o.diagnostics).reduce((last, cur) => last.concat(cur));

    return {
      files: outputFiles,
      diagnostics: outputDiagnostics,
    }
  }
}
