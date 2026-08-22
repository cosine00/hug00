(function () {
  var options = [
    { id: 'wenkai', label: '霞鹜文楷', href: 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.1.0/style.css' },
    { id: 'zhuque', label: '朱雀仿宋', href: 'https://cdn.jsdelivr.net/npm/@free-fonts/zhuque-fangsong@1.0.0/zhuque-fangsong.css' },
    { id: 'kinghwa', label: '京华老宋', href: 'https://ik.imagekit.io/fonts130/packages/jhlst/dist/%E4%BA%AC%E8%8F%AF%E8%80%81%E5%AE%8B%E4%BD%93v2_002/result.css' },
    { id: 'zhisong', label: '新致宋', href: 'https://fontsapi.zeoseven.com/22/main/result.css' }
  ];

  var button = document.querySelector('.masthead .tagline');
  var stylesheet = document.getElementById('blog-font-stylesheet');
  if (!button || !stylesheet) return;

  function currentIndex() {
    var id = document.documentElement.dataset.font || 'wenkai';
    var index = options.findIndex(function (option) { return option.id === id; });
    return index < 0 ? 0 : index;
  }

  function apply(option) {
    document.documentElement.dataset.font = option.id;
    stylesheet.href = option.href;
    button.setAttribute('aria-label', '当前字体：' + option.label + '，点击诗句切换');
    try { localStorage.setItem('blog-font', option.id); } catch (_) {}
  }

  apply(options[currentIndex()]);
  button.addEventListener('click', function () {
    apply(options[(currentIndex() + 1) % options.length]);
  });
  button.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      button.click();
    }
  });
})();
