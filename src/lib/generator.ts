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

import ts from 'typescript';

export interface OutputFile {
  filename: string;
  content: string;
}

/**
 * Information for debugging.
 */
export interface Diagnostic {
  fileName: string;
  line: number;
  character: number;
  message: string;
}

/**
 * Generates one or more files from the given SourceFile.
 */
export type Generator = (
  sourceFile: ts.SourceFile,
  program: ts.Program,
  languageServiceHost: ts.LanguageServiceHost,
  rootDir: string
) => {
  files: Array<OutputFile>,
  diagnostics: Array<Diagnostic>,
};
