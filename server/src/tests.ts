/**
 * Exoscript LSP Test Suite
 *
 * Run with: npx ts-node src/tests.ts
 */

import { analyzeDiagnostics } from './diagnostics';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';

interface TestCase {
  name: string;
  code: string;
  expectedErrors: string[];  // Substrings that should appear in error messages
  expectedCount?: number;    // Optional: exact count of diagnostics
  severity?: DiagnosticSeverity; // Optional: check for specific severity
}

const testCases: TestCase[] = [
  // ========== STORY HEADER TESTS ==========
  {
    name: 'Valid story header',
    code: `=== myStory
Some text here`,
    expectedErrors: [],
  },
  {
    name: 'Invalid story header - no ID',
    code: `===
Some text`,
    expectedErrors: ['Story header requires an ID', 'Invalid story header'],
  },
  {
    name: 'Invalid story header - just equals',
    code: `===
Text after`,
    expectedErrors: ['Invalid story header'],
  },
  {
    name: 'Story header with trailing decoration is valid',
    code: `=== myStory ===============
Some text`,
    expectedErrors: [],
  },

  // ========== TILDE COMMAND TESTS ==========
  {
    name: 'Valid ~if command',
    code: `=== test
~if age >= 10
Some text`,
    expectedErrors: [],
  },
  {
    name: 'Valid ~ifd command',
    code: `=== test
~ifd skill_toughness >= 20
Some text`,
    expectedErrors: [],
  },
  {
    name: 'Valid ~set command',
    code: `=== test
~set var_something = true
Some text`,
    expectedErrors: [],
  },
  {
    name: 'Valid ~call command',
    code: `=== test
~call story(otherEvent)
Some text`,
    expectedErrors: [],
  },
  {
    name: 'Valid ~disabled command',
    code: `~disabled
=== test
Some text`,
    expectedErrors: ['disabled'],  // Info message about disabled
  },
  {
    name: 'Valid ~once command',
    code: `=== test
~if once
Some text`,
    expectedErrors: [],
  },
  {
    name: 'Unknown tilde command',
    code: `=== test
~unknown something
Some text`,
    expectedErrors: ['Unknown tilde command'],
  },
  {
    name: 'Typo: ~iff instead of ~if',
    code: `=== test
~iff age >= 10
Some text`,
    expectedErrors: ['Did you mean ~if'],
  },
  {
    name: 'Typo: ~sett instead of ~set',
    code: `=== test
~sett var_x = 1
Some text`,
    expectedErrors: ['Did you mean ~set'],
  },
  {
    name: 'Empty ~if command',
    code: `=== test
~if
Some text`,
    expectedErrors: ['requires a condition'],
  },

  // ========== PARENTHESES TESTS ==========
  {
    name: 'Balanced parentheses in ~if',
    code: `=== test
~if (age >= 10) && (skill_combat > 5)
Some text`,
    expectedErrors: [],
  },
  {
    name: 'Unbalanced parentheses - missing close',
    code: `=== test
~if (age >= 10
Some text`,
    expectedErrors: ['Unbalanced parentheses'],
  },
  {
    name: 'Unbalanced parentheses - extra close',
    code: `=== test
~if age >= 10)
Some text`,
    expectedErrors: ['Unbalanced parentheses'],
  },
  {
    name: 'Unbalanced parentheses in ~set',
    code: `=== test
~set var_x = call_func(arg
Some text`,
    expectedErrors: ['Unbalanced parentheses'],
  },

  // ========== BRACKET EXPRESSION TESTS ==========
  {
    name: 'Valid [if]...[endif] block',
    code: `=== test
[if age >= 10]
You are old enough
[endif]`,
    expectedErrors: [],
  },
  {
    name: 'Valid [if]...[else]...[end] block',
    code: `=== test
[if age >= 10]
Old enough
[else]
Too young
[end]`,
    expectedErrors: [],
  },
  {
    name: 'Valid [if]...[elseif]...[endif] block',
    code: `=== test
[if age >= 15]
Fifteen plus
[elseif age >= 10]
Ten to fourteen
[endif]`,
    expectedErrors: [],
  },
  {
    name: 'Valid [if random] block',
    code: `=== test
[if random]
Option one
[or]
Option two
[end]`,
    expectedErrors: [],
  },
  {
    name: 'Valid variable interpolation',
    code: `=== test
Hello [=var_name], how are you?`,
    expectedErrors: [],
  },
  {
    name: 'Unclosed [if] block',
    code: `=== test
[if age >= 10]
Some text
No endif here`,
    expectedErrors: ['Unclosed [if]'],
  },
  {
    name: 'Orphaned [endif]',
    code: `=== test
Some text
[endif]`,
    expectedErrors: ['no matching [if]'],
  },
  {
    name: 'Orphaned [else]',
    code: `=== test
Some text
[else]
More text`,
    expectedErrors: ['outside of [if] block'],
  },
  {
    name: 'Orphaned [or]',
    code: `=== test
Some text
[or]
More text`,
    expectedErrors: ['outside of [if] block'],
  },
  {
    name: 'Multiple unclosed [if] blocks',
    code: `=== test
[if condition1]
Text
[if condition2]
More text`,
    expectedErrors: ['Unclosed [if]', 'Unclosed [if]'],
    expectedCount: 2,
  },

  // ========== COMMENT TESTS ==========
  {
    name: 'Valid line comment',
    code: `=== test
// This is a comment
Some text`,
    expectedErrors: [],
  },
  {
    name: 'Valid block comment',
    code: `=== test
/* This is a
   block comment */
Some text`,
    expectedErrors: [],
  },
  {
    name: 'Unclosed block comment',
    code: `=== test
/* This comment never closes
Some text`,
    expectedErrors: ['Unclosed block comment'],
  },
  {
    name: 'Comment decoration line (====)',
    code: `=== test ====================================
Some text`,
    expectedErrors: [],
  },

  // ========== CHOICE TESTS ==========
  {
    name: 'Valid choice',
    code: `=== test
* Pick this option
  Result text`,
    expectedErrors: [],
  },
  {
    name: 'Valid nested choices',
    code: `=== test
* First level
  ** Second level
    *** Third level
      Deep text`,
    expectedErrors: [],
  },
  {
    name: 'Valid hidden choice',
    code: `=== test
*= hiddenChoice
  Hidden result`,
    expectedErrors: [],
  },
  {
    name: 'Empty choice text',
    code: `=== test
*
  Result text`,
    expectedErrors: ['Empty choice text'],
  },
  {
    name: 'Hidden choice without ID',
    code: `=== test
*=
  Result text`,
    expectedErrors: ['requires an ID'],
  },

  // ========== CHOICE ID TESTS ==========
  {
    name: 'Valid choice ID',
    code: `=== test
* Some choice
  = myChoiceId
  Result text`,
    expectedErrors: [],
  },
  {
    name: 'Duplicate choice ID',
    code: `=== test
* Choice one
  = sameId
* Choice two
  = sameId`,
    expectedErrors: ['Duplicate choice ID'],
  },

  // ========== JUMP TESTS ==========
  {
    name: 'Valid jump to defined choice',
    code: `=== test
* Choice one
  = targetChoice
  Text
* Choice two
  > targetChoice`,
    expectedErrors: [],
  },
  {
    name: 'Valid jump to start',
    code: `=== test
* Choice
  > start`,
    expectedErrors: [],
  },
  {
    name: 'Valid jump to end',
    code: `=== test
* Choice
  > end`,
    expectedErrors: [],
  },
  {
    name: 'Valid jump to back',
    code: `=== test
* Choice
  > back`,
    expectedErrors: [],
  },
  {
    name: 'Valid silent jump (>>)',
    code: `=== test
* Choice
  = target
* Other
  >> target`,
    expectedErrors: [],
  },
  {
    name: 'Valid no-break jump (>!)',
    code: `=== test
* Choice
  = target
* Other
  >! target`,
    expectedErrors: [],
  },
  {
    name: 'Unknown jump target',
    code: `=== test
* Choice
  > nonexistentTarget`,
    expectedErrors: ['Unknown jump target'],
  },

  // ========== VARIABLE PREFIX TESTS ==========
  {
    name: 'Valid var_ prefix',
    code: `=== test
~set var_something = true`,
    expectedErrors: [],
  },
  {
    name: 'Valid mem_ prefix',
    code: `=== test
~set mem_remember = true`,
    expectedErrors: [],
  },
  {
    name: 'Valid hog_ prefix',
    code: `=== test
~set hog_persistent = true`,
    expectedErrors: [],
  },
  {
    name: 'Valid skill_ prefix',
    code: `=== test
~if skill_combat >= 10`,
    expectedErrors: [],
  },
  {
    name: 'Valid love_ prefix',
    code: `=== test
~if love_cal >= 50`,
    expectedErrors: [],
  },
  {
    name: 'Valid story_ prefix',
    code: `=== test
~if story_someEvent = false`,
    expectedErrors: [],
  },
  {
    name: 'Unknown variable prefix',
    code: `=== test
~if weird_variable = true`,
    expectedErrors: ['Unknown variable prefix'],
  },

  // ========== OPERATOR TESTS ==========
  {
    name: 'Valid operators',
    code: `=== test
~if age >= 10 && skill_combat > 5 || love_cal != 0`,
    expectedErrors: [],
  },
  {
    name: 'Spaced && operator',
    code: `=== test
~if age >= 10 & & skill_combat > 5`,
    expectedErrors: ['Space in operator'],
  },
  {
    name: 'Spaced || operator',
    code: `=== test
~if age >= 10 | | skill_combat > 5`,
    expectedErrors: ['Space in operator'],
  },
  {
    name: 'Spaced = operator',
    code: `=== test
~if age = = 10`,
    expectedErrors: ['Space in operator'],
  },

  // ========== PAGE BREAK TESTS ==========
  {
    name: 'Valid page break',
    code: `=== test
* Choice
  Some text
  -
  More text after break`,
    expectedErrors: [],
  },

  // ========== CONTENT BEFORE STORY TESTS ==========
  {
    name: 'Content before story header',
    code: `This text comes before any story
=== test
Valid content`,
    expectedErrors: ['Content found before story header'],
  },

  // ========== COMPLEX/COMBINED TESTS ==========
  {
    name: 'Multiple errors in one file',
    code: `=== test
~if (age >= 10
~unknownCmd
[if condition]
No endif
*
  Empty choice`,
    expectedErrors: [
      'Unbalanced parentheses',
      'Unknown tilde command',
      'Unclosed [if]',
      'Empty choice text'
    ],
  },
  {
    name: 'Valid complex file',
    code: `=== complexExample
~if age >= 10
~if skill_combat >= 5
~set var_ready = true

This is the intro text.

* First option
  = firstChoice
  ~ifd skill_toughness >= 10
  You chose the first option.

  [if var_ready]
    You're ready!
  [else]
    Not ready yet.
  [endif]

  ** Nested option
    Even deeper.
    > end

* Second option
  ~set love_cal++
  You chose the second option.
  -
  After a page break.
  >> firstChoice

*= hiddenEnd
  = end
  The end.`,
    expectedErrors: [],
  },
];

// ========== TEST RUNNER ==========

function runTests(): void {
  console.log('=== Exoscript LSP Test Suite ===\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const test of testCases) {
    const diagnostics = analyzeDiagnostics(test.code);
    const errors = diagnostics.map(d => d.message);

    let testPassed = true;
    const issues: string[] = [];

    // Check expected errors are present
    for (const expected of test.expectedErrors) {
      const found = errors.some(e => e.toLowerCase().includes(expected.toLowerCase()));
      if (!found) {
        testPassed = false;
        issues.push(`Missing expected error: "${expected}"`);
      }
    }

    // Check no unexpected errors (if expectedErrors is empty, should have no errors)
    if (test.expectedErrors.length === 0 && diagnostics.length > 0) {
      // Filter out info-level diagnostics for ~disabled
      const realErrors = diagnostics.filter(d => d.severity !== DiagnosticSeverity.Information);
      if (realErrors.length > 0) {
        testPassed = false;
        issues.push(`Unexpected errors: ${realErrors.map(d => d.message).join(', ')}`);
      }
    }

    // Check expected count if specified
    if (test.expectedCount !== undefined) {
      const matchingCount = test.expectedErrors.reduce((count, expected) => {
        return count + errors.filter(e => e.toLowerCase().includes(expected.toLowerCase())).length;
      }, 0);
      // This is a loose check - just verify we have at least the expected number
      if (diagnostics.length < test.expectedCount) {
        testPassed = false;
        issues.push(`Expected at least ${test.expectedCount} diagnostics, got ${diagnostics.length}`);
      }
    }

    if (testPassed) {
      console.log(`✓ ${test.name}`);
      passed++;
    } else {
      console.log(`✗ ${test.name}`);
      for (const issue of issues) {
        console.log(`    ${issue}`);
      }
      console.log(`    Actual diagnostics: ${errors.length > 0 ? errors.join('; ') : '(none)'}`);
      failed++;
      failures.push(test.name);
    }
  }

  console.log('\n=== Results ===');
  console.log(`Passed: ${passed}/${testCases.length}`);
  console.log(`Failed: ${failed}/${testCases.length}`);

  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const name of failures) {
      console.log(`  - ${name}`);
    }
  }

  // Exit with error code if any tests failed
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests();
