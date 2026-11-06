import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCheckpoint, verifyCheckpoint } from "../server/checkpoint.ts";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-checkpoint-"));
  const source = path.join(root, "source");
  fs.mkdirSync(path.join(source, "nested"), { recursive: true });
  fs.writeFileSync(path.join(source, "index.html"), "<h1>source</h1>");
  fs.writeFileSync(path.join(source, "nested", "data.txt"), "content");
  return { root, source, destination: path.join(root, "checkpoint") };
}

test("checkpoint copies the complete project and verifies it", () => {
  const { root, source, destination } = fixture();
  try {
    assert.equal(createCheckpoint(source, destination), destination);
    assert.equal(fs.readFileSync(path.join(destination, "index.html"), "utf8"), "<h1>source</h1>");
    assert.equal(fs.readFileSync(path.join(destination, "nested", "data.txt"), "utf8"), "content");
    assert.doesNotThrow(() => verifyCheckpoint(source, destination));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkpoint refuses to overwrite an existing destination", () => {
  const { root, source, destination } = fixture();
  try {
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "keep.txt"), "keep");
    assert.throws(() => createCheckpoint(source, destination), /existe/i);
    assert.equal(fs.readFileSync(path.join(destination, "keep.txt"), "utf8"), "keep");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkpoint verification detects an incomplete copy", () => {
  const { root, source, destination } = fixture();
  try {
    fs.cpSync(source, destination, { recursive: true });
    fs.rmSync(path.join(destination, "nested", "data.txt"));
    assert.throws(() => verifyCheckpoint(source, destination), /faltan|incompleta|verific/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkpoint verification detects corrupted content", () => {
  const { root, source, destination } = fixture();
  try {
    fs.cpSync(source, destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "index.html"), "<h1>other</h1>");
    assert.throws(() => verifyCheckpoint(source, destination), /difiere|contenido|verific/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a copy or permission failure is reported and the partial destination is cleaned", () => {
  const { root, source, destination } = fixture();
  try {
    const fileSystem = {
      ...fs,
      cpSync: (_source, target) => {
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, "partial.txt"), "partial");
        throw new Error("permiso denegado al copiar");
      },
    };
    assert.throws(() => createCheckpoint(source, destination, { fileSystem }), /permiso denegado/);
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkpoint fails when the source does not exist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factoryos-checkpoint-"));
  try {
    assert.throws(() => createCheckpoint(path.join(root, "missing"), path.join(root, "checkpoint")), /no existe|directorio/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
