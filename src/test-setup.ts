import {NgModule} from '@angular/core';
import {afterEach, beforeEach} from 'vitest';
import {getTestBed, ɵgetCleanupHook as getCleanupHook} from '@angular/core/testing';
import {BrowserTestingModule, platformBrowserTesting} from '@angular/platform-browser/testing';

beforeEach(getCleanupHook(false));
afterEach(getCleanupHook(true));

const ANGULAR_TESTBED_SETUP = Symbol.for('@angular/cli/testbed-setup');

if (!(globalThis as Record<PropertyKey, unknown>)[ANGULAR_TESTBED_SETUP]) {
  (globalThis as Record<PropertyKey, unknown>)[ANGULAR_TESTBED_SETUP] = true;

  @NgModule({
    providers: [],
  })
  class TestModule {}

  getTestBed().initTestEnvironment([BrowserTestingModule, TestModule], platformBrowserTesting(), {
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
}
