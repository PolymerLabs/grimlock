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
import * as fs from 'fs';

/**
 * A LanguageServiceHost that overlays a versioned in-memory file collection
 * on top of the filesystem. This host also caches files read from the
 * filesystem without expiration. This is useful for testing and one-time
 * transforms.
 */
export class OverlayLanguageServiceHost implements ts.LanguageServiceHost {
  compilerOptions: ts.CompilerOptions;
  packageRoot: string;

  fileCache = new Map<string, string>();

  files: Map<
    string,
    {
      version: number;
      source: string;
    }
  >;

  constructor(packageRoot: string, compilerOptions: ts.CompilerOptions) {
    this.packageRoot = packageRoot;
    this.compilerOptions = compilerOptions;
    this.files = new Map();
  }

  getCompilationSettings(): ts.CompilerOptions {
    return this.compilerOptions;
  }

  getScriptFileNames(): string[] {
    return Array.from(this.files.keys());
  }

  getScriptVersion(fileName: string) {
    const file = this.files.get(fileName);
    return (file === undefined ? -1 : file.version).toString();
  }

  fileExists(fileName: string): boolean {
    if (this.files.has(fileName)) {
      return true;
    }
    if (!fileName.startsWith(this.packageRoot)) {
      return false;
    }
    try {
      fs.statSync(fileName);
      return true;
    } catch (e) {
      return false;
    }
  }

  readFile(fileName: string): string | undefined {
    if (this.files.has(fileName)) {
      return this.files.get(fileName)!.source;
    }
    let contents = this.fileCache.get(fileName);
    if (contents !== undefined) {
      return contents;
    }
    contents = fs.readFileSync(fileName, 'utf-8');
    this.fileCache.set(fileName, contents);
    return contents;
  }

  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    if (!this.fileExists(fileName)) {
      return undefined;
    }
    return ts.ScriptSnapshot.fromString(this.readFile(fileName)!);
  }

  getCurrentDirectory(): string {
    return this.packageRoot;
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }
}
