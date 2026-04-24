import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSyntheticDocument } from "./specialized-regression-helpers.mjs";

test("driver-license identity documents resolve client name and id type for default filenames", async () => {
  const { insight, filename } = await analyzeSyntheticDocument({
    id: "identity-driver-license-1",
    name: "license-image.png",
    mimeType: "image/png",
    text: `
WISCONSIN DRIVER LICENSE
DL
CLASS D
SEX M
HGT 5-10
EYES BLU
ISS 01/15/2024
EXP 01/15/2032
DOB 02/03/1985
CHRISTOPHER BAKKEN
N1345 MAPLE HILLS DRIVE
FONTANA ON GENEVA LAKE WI 53125
`,
  });

  assert.equal(insight.documentTypeId, "identity_document");
  assert.equal(insight.detectedClient, "Christopher Bakken");
  assert.equal(insight.metadata.idType, "Driver License");

  assert.equal(filename, "Bakken_Christopher_Driver_License.png");
});

test("passport-like identity documents resolve passport name and id type for default filenames", async () => {
  const { insight, filename } = await analyzeSyntheticDocument({
    id: "identity-passport-1",
    name: "passport-image.png",
    mimeType: "image/png",
    text: `
UNITED STATES OF AMERICA
PASSPORT
Passport No. 123456789
Name Christopher Bakken
Nationality United States of America
Date of Birth 02/03/1985
Sex M
Place of Birth Wisconsin
Expiration Date 02/03/2035
`,
  });

  assert.equal(insight.documentTypeId, "identity_document");
  assert.equal(insight.detectedClient, "Christopher Bakken");
  assert.notEqual(insight.metadata.idType, "Driver License");
  assert.equal(insight.metadata.idType, "Passport");

  assert.equal(filename, "Bakken_Christopher_Passport.png");
});
