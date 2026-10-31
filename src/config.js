import fs from 'node:fs';
import path from 'node:path';
import { PROFILE_PATH, ROOT } from './paths.js';

const DEFAULTS = {
  name: '',
  email: '',
  phone: '',
  linkedin: '',
  github: '',
  portfolio: '',
  currentLocation: '',
  resumePath: './resume.pdf',
  targetRoles: [],
  skills: [],
  excludeKeywords: [],
  locations: ['Remote'],
  strictLocation: false,
  remoteOnly: false,
  seniority: '',
  minSalary: null,
  noticePeriod: '',
  workAuthorization: '',
  extraNotes: '',
  sources: ['remotive', 'remoteok', 'arbeitnow', 'themuse', 'jobicy', 'himalayas', 'adzuna'],
  adzunaCountry: 'in',
  maxAgeDays: 30,
  maxJobsToRank: 25,
  minScoreToPrepare: 70,
  autoPrepareTop: 5,
};

export function loadProfile() {
  // In CI the profile comes from the PROFILE_JSON secret so personal data never lands in the repo.
  if (process.env.PROFILE_JSON) {
    return { ...DEFAULTS, ...JSON.parse(process.env.PROFILE_JSON), resumePath: process.env.RESUME_PATH || '' };
  }
  if (!fs.existsSync(PROFILE_PATH)) {
    throw new Error(`profile.json not found. Run "node src/cli.js init" first, then edit ${PROFILE_PATH}`);
  }
  const profile = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8')) };
  if (profile.resumePath) profile.resumePath = path.resolve(ROOT, profile.resumePath);
  return profile;
}
