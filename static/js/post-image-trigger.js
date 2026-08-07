(function () {
  'use strict';

  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m4 17 4.5-4.5 3.5 3 2.5-2.5 5.5 5"></path></svg>';

  function isArticleImage(image) {
    return !image.closest('.post-image-preview') &&
      !image.matches('.avatar, .tk-avatar-img') &&
      !/emotion/i.test(image.getAttribute('src') || '');
  }

  function hasReadableText(element) {
    if (!element) return false;
    var copy = element.cloneNode(true);
    Array.prototype.forEach.call(copy.querySelectorAll('img, script, style, .post-image-trigger'), function (node) {
      node.remove();
    });
    return copy.textContent.replace(/\s+/g, '').length > 0;
  }

  function nearestTextBlock(image, content, textBlocks) {
    var ownBlock = image.closest('p, li, blockquote');
    if (ownBlock && content.contains(ownBlock) && hasReadableText(ownBlock)) return ownBlock;

    var nearest = null;
    for (var i = 0; i < textBlocks.length; i += 1) {
      var block = textBlocks[i];
      if (block === image || block.contains(image)) continue;
      if (block.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING) {
        nearest = block;
      } else {
        break;
      }
    }
    return nearest;
  }

  function sourceBlock(image, content) {
    var block = image.closest('figure, p, .gallery-photo');
    return block && content.contains(block) ? block : image;
  }

  function makeTrigger(images, articleImages) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'post-image-trigger';
    button.dataset.tooltip = '查看图片';
    button.setAttribute('aria-label', '查看' + images.length + '张图片');
    button.innerHTML = ICON +
      (images.length > 1 ? '<span class="post-image-count">+' + (images.length - 1) + '</span>' : '') +
      '<span class="post-image-preview" aria-hidden="true"><img src="" alt="" loading="lazy" decoding="async"></span>';
    button.querySelector('.post-image-preview img').src = images[0].currentSrc || images[0].src;
    button.addEventListener('click', function () {
      var urls = articleImages.map(function (image) { return image.currentSrc || image.src; });
      var selectedUrl = images[0].currentSrc || images[0].src;
      if (window.ViewImage && typeof window.ViewImage.display === 'function') {
        window.ViewImage.display(urls, selectedUrl);
      } else {
        window.open(selectedUrl, '_blank', 'noopener');
      }
    });
    return button;
  }

  function initPostImages() {
    var content = document.querySelector('.post-content');
    if (!content || content.dataset.imageTriggersReady === 'true') return;

    var images = Array.prototype.filter.call(content.querySelectorAll('img'), isArticleImage);
    if (!images.length) return;
    content.dataset.imageTriggersReady = 'true';

    var textBlocks = Array.prototype.filter.call(
      content.querySelectorAll('p, li, blockquote'),
      hasReadableText
    );
    var groups = [];
    images.forEach(function (image) {
      var block = sourceBlock(image, content);
      var anchor = nearestTextBlock(image, content, textBlocks);
      var group = groups.find(function (item) { return item.anchor === anchor; });
      if (!group) {
        group = { anchor: anchor, firstBlock: block, blocks: [], images: [] };
        groups.push(group);
      }
      if (group.blocks.indexOf(block) === -1) group.blocks.push(block);
      group.images.push(image);
      image.classList.add('post-image-source');
    });

    groups.forEach(function (group) {
      var trigger = makeTrigger(group.images, images);
      if (group.anchor) {
        group.anchor.appendChild(document.createTextNode('\u00a0\u00a0'));
        group.anchor.appendChild(trigger);
      } else {
        var holder = document.createElement('p');
        holder.className = 'post-image-trigger-line';
        holder.appendChild(trigger);
        group.firstBlock.parentNode.insertBefore(holder, group.firstBlock);
      }
      group.blocks.forEach(function (block) {
        if (block !== group.images[0] && !hasReadableText(block)) {
          block.classList.add('post-image-source-block');
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPostImages);
  } else {
    initPostImages();
  }
}());
