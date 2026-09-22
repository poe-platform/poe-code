/** Saved UTF-8 controls derived independently from the pinned contract.
 * Native replay is a manual QA cell, never a unit-test oracle process.
 */
export const independentFixtures: readonly (readonly [string, string, readonly string[], string])[] = [
  ["Q01-nested", '<div>A<div>B</div>C</div>', ['div', '-t'], 'ABC\nB\n'],
  ["Q02-list-duplicates", '<p>é😀</p><p>二</p>', ['p,p,:not(div)', '-a', 'missing'], ''],
  ["Q03-duplicate-matches", '<p>é😀</p><p>二</p>', ['p,p', '-t'], 'é😀\n二\n'],
  ["Q04-quoted", '<p title="a > b &quot;c&quot;" data-x=\'d > e\'>X</p>', ['p', '-a', 'title', '-a', 'data-x'], 'a > b "c"\nd > e\n'],
  ["Q05-entities", '<p title="&notit; &amp=">&notit; &amp=</p>', ['p', '-t'], '¬it; &=\n'],
  ["Q06-attribute-entities", '<p title="&notit; &amp=">X</p>', ['p', '-a', 'title'], '&notit; &amp=\n'],
  ["Q07-incomplete", '<ul><li>A<li>B', ['li'], '<li>A</li>\n<li>B</li>\n'],
  ["Q08-raw-rcdata", '<div><script>&amp;<b></script><textarea>&amp;&lt;b&gt;</textarea></div>', ['div', '-t'], '&amp;<b>&<b>\n'],
  ["Q09-template-foreign", '<div><template><p>hidden</p></template><svg viewbox="0 0"><foreignobject><p>shown</p></foreignobject></svg></div>', ['p', '-t'], 'shown\n'],
  ["Q10-missing", '<p id="I">X</p>', ['p', '-a', 'id', '-a', 'missing'], 'I\n'],
  ["Q11-empty", '<p id="">X</p>', ['p', '-a', 'id', '-a', 'missing'], '\n'],
  ["Q12-whitespace", '<p> \t\n</p>', ['p', '-t', '-i'], '\n'],
  ["Q13-mixed", '<p> A <b>二</b> </p>', ['p', '-t', '-i'], ' A \n二\n\n'],
  ["Q14-url-family", '<a href="/root"></a><a href="child"></a><a href="?q"></a><a href="#f"></a><a href="//other.test/x"></a><a href="////host/x"></a>', ['a', '-a', 'href', '-b', 'https://e.test/dir/page'], 'https://e.test/root\nhttps://e.test/dir/child\nhttps://e.test/dir/page?q\nhttps://e.test/dir/page#f\nhttps://other.test/x\nhost/x\n'],
  ["Q15-base-precedence", '<base href="https://d.test/x/"><a href="?q">X</a>', ['a', '-a', 'href', '-B', '-b', 'https://e.test/'], 'https://d.test/x/?q\n'],
  ["Q16-descendants", '<div><a href="/x">X</a><img src="child"></div>', ['div', '-b', 'https://e.test/'], '<div><a href="/x">X</a><img src="child"></div>\n'],
  ["Q17-pretty-mixed", '<div>A<span>B</span><p>C</p>D</div>', ['div', '-p'], '\n<div>A<span>B</span>\n  <p>C\n  </p>\n  D\n</div>\n'],
  ["Q18-remove-two", '<div><span>1</span><span>2</span></div>', ['div', '-r', 'span'], '<div><span>2</span></div>\n']
];
