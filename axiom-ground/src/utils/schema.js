import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonIfExists } from './core.js';

function typeMatches(value, expected) {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'null') return value === null;
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === expected;
}

function validateNode(value, schema, location, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push(`${location} expected ${types.join('|')}`);
      return;
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
    errors.push(`${location} expected constant ${JSON.stringify(schema.const)}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${location} expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
  }

  if (schema.required && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${location}.${key} is required`);
    }
  }

  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validateNode(value[key], childSchema, `${location}.${key}`, errors);
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'additionalProperties') && value && typeof value === 'object' && !Array.isArray(value)) {
    const knownKeys = schema.properties ? Object.keys(schema.properties) : [];
    for (const [key, childValue] of Object.entries(value)) {
      if (knownKeys.includes(key)) continue;
      if (schema.additionalProperties === false) {
        errors.push(`${location}.${key} is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateNode(childValue, schema.additionalProperties, `${location}.${key}`, errors);
      }
    }
  }

  if (schema.items && Array.isArray(value)) {
    value.forEach((item, index) => validateNode(item, schema.items, `${location}[${index}]`, errors));
  }
}

function validateJsonSchema(value, schema) {
  const errors = [];
  validateNode(value, schema, '$', errors);
  return { valid: errors.length === 0, errors };
}

export function assertValidSchema(value, schemaPath, artifactLabel = 'artifact') {
  const schema = readJsonIfExists(schemaPath);
  if (!schema) throw new Error(`schema not found for ${artifactLabel}: ${schemaPath}`);
  const result = validateJsonSchema(value, schema);
  if (!result.valid) {
    throw new Error(`${artifactLabel} failed schema validation: ${result.errors.join('; ')}`);
  }
  return true;
}

export function bundledSchemaPath(name) {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas', `${name}.schema.json`);
}
