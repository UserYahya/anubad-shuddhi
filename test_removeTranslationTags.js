import { removeTranslationTags } from './server.js';
import assert from 'assert';

console.log('Running translation template removal test cases...');

const testCases = [
  {
    name: 'Remove exact {{যান্ত্রিক অনুবাদ}}',
    input: '{{যান্ত্রিক অনুবাদ}}',
    expected: ''
  },
  {
    name: 'Remove exact {{রুক্ষ অনুবাদ}}',
    input: '{{রুক্ষ অনুবাদ}}',
    expected: ''
  },
  {
    name: 'Remove parameterized {{যান্ত্রিক অনুবাদ|1=ইংরেজি|date=মে ২০২৪}}',
    input: '{{যান্ত্রিক অনুবাদ|1=ইংরেজি|date=মে ২০২৪}}',
    expected: ''
  },
  {
    name: 'Remove parameterized {{যান্ত্রিক অনুবাদ|তারিখ=মে ২০২৪}}',
    input: '{{যান্ত্রিক অনুবাদ|তারিখ=মে ২০২৪}}',
    expected: ''
  },
  {
    name: 'Remove parameterized {{রুক্ষ অনুবাদ|ভাষা=ইংরেজি|date=মে ২০২৪}}',
    input: '{{রুক্ষ অনুবাদ|ভাষা=ইংরেজি|date=মে ২০২৪}}',
    expected: ''
  },
  {
    name: 'Remove parameterized templates embedded in text',
    input: 'Some text {{যান্ত্রিক অনুবাদ|ভাষা=ইংরেজি}} more text',
    expected: 'Some text  more text'
  },
  {
    name: 'Remove multiple templates',
    input: '{{যান্ত্রিক অনুবাদ|1=ইংরেজি}} Text {{রুক্ষ অনুবাদ|তারিখ=মে ২০২৪}}',
    expected: 'Text'
  },
  {
    name: 'Do not remove regular templates',
    input: '{{তথ্যছক ব্যক্তি|নাম=রহিম}}',
    expected: '{{তথ্যছক ব্যক্তি|নাম=রহিম}}'
  }
];

let failed = 0;
for (const tc of testCases) {
  try {
    const actual = removeTranslationTags(tc.input);
    assert.strictEqual(actual, tc.expected);
    console.log(`[PASS] ${tc.name}`);
  } catch (err) {
    console.error(`[FAIL] ${tc.name}`);
    console.error(`  Input:    ${tc.input}`);
    console.error(`  Expected: ${tc.expected}`);
    console.error(`  Actual:   ${err.actual}`);
    failed++;
  }
}

if (failed === 0) {
  console.log('\nAll tests passed successfully!');
  process.exit(0);
} else {
  console.error(`\n${failed} test case(s) failed.`);
  process.exit(1);
}
