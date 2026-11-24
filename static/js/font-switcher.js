(function () {
  // Order is the click order: every press moves one step down this list and
  // wraps. 朱雀仿宋 leads because it is the default the header ships with;
  // 系统字体 has no stylesheet — picking it just stops loading a webfont.
  var options = [
    { id: 'zhuque', label: '朱雀仿宋', href: 'https://cdn.jsdelivr.net/npm/@free-fonts/zhuque-fangsong@1.0.0/zhuque-fangsong.css' },
    { id: 'xixihei', label: '霞鹜新晰黑', href: 'https://fontsapi.zeoseven.com/19/main/result.css' },
    { id: 'wenkai', label: '霞鹜文楷', href: 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.1.0/style.css' },
    { id: 'zhisong', label: '新致宋', href: 'https://fontsapi.zeoseven.com/22/main/result.css' },
    { id: 'system', label: '系统字体', href: '' }
  ];

  var button = document.querySelector('.masthead .tagline');
  var stylesheet = document.getElementById('blog-font-stylesheet');
  if (!button || !stylesheet) return;

  function currentIndex() {
    var id = document.documentElement.dataset.font || 'zhuque';
    var index = options.findIndex(function (option) { return option.id === id; });
    return index < 0 ? 0 : index;
  }

  function apply(option) {
    document.documentElement.dataset.font = option.id;
    // 空 href 会把当前页面当样式表请求，所以「系统」只停用、不赋值
    if (option.href) {
      stylesheet.disabled = false;
      stylesheet.href = option.href;
    } else {
      stylesheet.disabled = true;
    }
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
