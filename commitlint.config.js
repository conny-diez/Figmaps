// Der Maßstab, gegen den `lefthook` jede Commit-Botschaft prüft (siehe
// `lefthook.yml`, Hook `commit-msg`). Er ist die *einzige* Quelle der erlaubten
// Typen — `scripts/changelog.mjs` liest dieselbe Liste, damit Durchsetzung und
// Changelog nie zwei verschiedene Vorstellungen davon haben, was ein `feat` ist.
//
// WARUM CONVENTIONAL COMMITS. Bis hierher waren die Botschaften dieses Repos
// erzählend und deutsch — gut zu lesen, aber nicht maschinell zu gruppieren. Ab
// jetzt trägt die *erste Zeile* eine feste Form (`typ(bereich): beschreibung`),
// aus der sich ein Changelog ohne Handarbeit ableiten lässt. Der erzählende Teil
// wandert in den Body, der frei bleibt.
//
// WAS ERZWUNGEN WIRD und was nicht: die Form der Kopfzeile (Typ aus der Liste,
// Doppelpunkt, nicht leer, keine überlange Zeile). Sprache und Stil der
// Beschreibung bleiben frei — eine Regel, die Deutsch verböte, wäre hier falsch.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Die erlaubten Typen. `feat` und `fix` erscheinen im Changelog als eigene
    // Abschnitte, die übrigen unter „Sonstiges" bzw. gar nicht (siehe
    // `scripts/changelog.mjs`). Wer einen Typ hier ergänzt, ergänzt ihn dort.
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    // Die erzählenden Botschaften dieses Repos sind lang; ein hartes Limit auf
    // der Body-Zeile würde sie zerhacken. Die Kopfzeile bleibt begrenzt, der
    // Body nicht.
    'body-max-line-length': [0, 'always'],
    // DEUTSCH. `@commitlint/config-conventional` verbietet eine großgeschriebene
    // Beschreibung (`subject-case` gegen sentence-/start-case) — eine Regel aus
    // englischer Gewohnheit. Im Deutschen ist jedes Substantiv groß, „feat:
    // Kontrastprüfung ergänzt" wäre damit ein Fehler. Die Groß-/Kleinschreibung
    // der Beschreibung bleibt deshalb frei; erzwungen wird die *Form*, nicht die
    // Sprache.
    'subject-case': [0],
  },
}
