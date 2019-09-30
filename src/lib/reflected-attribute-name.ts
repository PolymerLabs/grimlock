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

/**
 * Represents a JavaScript property that reflects as an HTML attribute.
 */
class ReflectedProperty {
  public propertyName: string;
  public attributeName: string;
  public isBoolean: boolean;

  constructor(propertyName: string, options: ReflectedPropertyOptions = {}) {
    this.propertyName = propertyName;
    this.attributeName = options.attributeName === undefined ? propertyName : options.attributeName;
    this.isBoolean = options.isBoolean === undefined ? false : options.isBoolean;
  }
}

/**
 * Options for the ReflectedProperty class.
 */
interface ReflectedPropertyOptions {
  /**
   * If present, indicates the reflected attribute name differs from the property name.
   */
  attributeName?: string

  /**
   * Whether the property reflects to an HTML boolean attribute.
   */
  isBoolean?: boolean
}

/**
 * Elements and their special properties that should be reflected to attributes
 * when set.
 *
 * Modify this object to add reflected attributes.
 *
 * Each item in the array takes the following format:
 *
 * first: Element name or array of element names.
 * rest:  Array of ([property name, reflected attribute name] or
 *        property name (if reflected attribute name is identical).
 */
const reflectedPropertiesSource: Array<{
  tagNames: string[];
  reflectedProperties: ReflectedProperty[];
}> = [
  {
    tagNames: ['input', 'option'],
    reflectedProperties: [new ReflectedProperty('value')],
  },
  {
    tagNames: ['input'],
    reflectedProperties: [
      new ReflectedProperty('checked', {isBoolean: true}),
      new ReflectedProperty('disabled', {isBoolean: true}),
      new ReflectedProperty('indeterminate', {isBoolean: true})
    ],
  },
  {
    tagNames: ['*'],
    reflectedProperties: [
      new ReflectedProperty('className', {attributeName: 'class'}),
      new ReflectedProperty('id')
    ],
  },
];


// `reflectedAttributesSource` is easy to visually parse, but the data can be restructured
// as a map of maps, `reflectedProperties`, for faster runtime lookup.
// Example entry:
// { '*': { 'className': new ReflectedProperty('className', {attributeName: 'class'}) } }
const reflectedProperties = new Map<string, Map<string, ReflectedProperty>>();
const addReflectionForElement = (
  elementName: string,
  reflectedProperty: ReflectedProperty
) => {
  let reflectedAttribute = reflectedProperties.get(elementName);
  if (reflectedAttribute === undefined) {
    reflectedAttribute = new Map();
    reflectedProperties.set(elementName, reflectedAttribute);
  }
  reflectedAttribute.set(reflectedProperty.propertyName, reflectedProperty);
};
const addReflectionsForElement = (
  elementName: string,
  reflectedProperties: ReflectedProperty[]
) => {
  for (const reflectedProperty of reflectedProperties) {
    addReflectionForElement(elementName, reflectedProperty);
  }
};
for (const entry of reflectedPropertiesSource) {
  for (const elementName of entry.tagNames) {
    addReflectionsForElement(elementName, entry.reflectedProperties);
  }
}

/**
 * Given a `propertyName` and element `tagName`, return the name and type of the corresponding
 * reflected attribute, or undefined if it doesn't exist for that tag name.
 *
 * @param propertyName The name of a JavaScript property
 * @param tagName The tag name of an HTML element
 */
export const getReflectedAttribute = (
  propertyName: string,
  tagName: string
): {
  name: string,
  isBoolean: boolean
} | undefined => {
  const properties = reflectedProperties.get(tagName);
  let reflection;
  if (properties !== undefined && properties.has(propertyName)) {
    reflection = properties.get(propertyName)!;
  } else {
    reflection = reflectedProperties.get('*')!.get(propertyName);
    if (reflection === undefined) {
      return undefined;
    }
  }
  return {name: reflection.attributeName, isBoolean: reflection.isBoolean};
};
