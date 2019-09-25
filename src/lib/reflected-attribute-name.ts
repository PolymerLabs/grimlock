class Reflection {
  public propertyName: string;
  public attributeName: string;
  public isBoolean: boolean = false;

  constructor(propertyName: string, attributeName?: string) {
    this.propertyName = propertyName;
    if (attributeName !== undefined) {
      this.attributeName = attributeName;
    } else {
      this.attributeName = propertyName
    }
  }

  setBoolean() {
    this.isBoolean = true;
    return this;
  }
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
const reflectedAttributesSource: Array<{
  tagNames: string[];
  reflections: Reflection[];
}> = [
  {
    tagNames: ['input', 'option'],
    reflections: [new Reflection('value')],
  },
  {
    tagNames: ['input'],
    reflections: [
      new Reflection('checked').setBoolean(),
      new Reflection('disabled').setBoolean(),
      new Reflection('indeterminate').setBoolean()
    ],
  },
  {
    tagNames: ['*'],
    reflections: [
      new Reflection('className', 'class'),
      new Reflection('id')
    ],
  },
];

// reflectedAttributesSource is easy to visually parse, but we can reconfigure the
// data structure into a map of maps for faster lookup at runtime.
// Example entry: {'*': {'className': Reflection}}
const reflectedAttributes = new Map<string, Map<string, Reflection>>();
const addReflectionForElement = (
  elementName: string,
  reflection: Reflection
) => {
  let reflectedAttribute = reflectedAttributes.get(elementName);
  if (reflectedAttribute === undefined) {
    reflectedAttribute = new Map();
    reflectedAttributes.set(elementName, reflectedAttribute);
  }
  reflectedAttribute.set(reflection.propertyName, reflection);
};
const addReflectionsForElement = (
  elementName: string,
  reflections: Reflection[]
) => {
  for (const reflection of reflections) {
    addReflectionForElement(elementName, reflection);
  }
};
for (const entry of reflectedAttributesSource) {
  for (const elementName of entry.tagNames) {
    addReflectionsForElement(elementName, entry.reflections);
  }
}

/**
 * Given a property name and element tag name, return the name and type of the corresponding
 * reflected attribute, or undefined if it doesn't exist.
 */
export const getReflectedAttribute = (
  propertyName: string,
  tagName: string
): {
  name: string,
  isBoolean: boolean
} | undefined => {
  const attributes = reflectedAttributes.get(tagName);
  let reflection;
  if (attributes !== undefined && attributes.has(propertyName)) {
    reflection = attributes.get(propertyName)!;
  } else {
    reflection = reflectedAttributes.get('*')!.get(propertyName);
    if (reflection === undefined) {
      return undefined;
    }
  }
  return {name: reflection.attributeName, isBoolean: reflection.isBoolean};
};
