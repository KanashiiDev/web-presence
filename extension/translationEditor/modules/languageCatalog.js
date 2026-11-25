// Submit is blocked only by a maintainer's explicit `published:false` override
// in languages.json. A language below the coverage threshold must remain
// submittable, otherwise a new language could never reach publication.
function teSubmissionIsBlocked(entry) {
  return entry?.published === false;
}
