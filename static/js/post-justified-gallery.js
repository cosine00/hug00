(function () {
  'use strict';

  var GAP = 8;

  function directVisibleImages(block) {
    return Array.prototype.filter.call(block.children, function (child) {
      return child.tagName === 'IMG' && !child.hidden && !child.hasAttribute('no-view');
    });
  }

  function isImageOnlyBlock(block) {
    return Array.prototype.every.call(block.childNodes, function (node) {
      if (node.nodeType === Node.TEXT_NODE) return !node.textContent.trim();
      return node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IMG';
    });
  }

  function waitForImage(image) {
    if (image.complete) return Promise.resolve();
    return new Promise(function (resolve) {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }

  function imageRatio(image) {
    return image.naturalWidth > 0 && image.naturalHeight > 0
      ? image.naturalWidth / image.naturalHeight
      : 4 / 3;
  }

  function targetRowHeight(width) {
    return Math.min(260, Math.max(150, width * 0.28));
  }

  function rowHeight(images, width) {
    var ratioSum = images.reduce(function (sum, image) {
      return sum + imageRatio(image);
    }, 0);
    return (width - GAP * (images.length - 1)) / ratioSum;
  }

  function rowCost(images, width, targetHeight) {
    var height = rowHeight(images, width);
    var deviation = Math.log(height / targetHeight);
    var cost = deviation * deviation + 0.04;
    if (height > targetHeight * 2) {
      cost += Math.pow(height / targetHeight - 2, 2);
    }
    if (height < targetHeight * 0.55) {
      cost += Math.pow(0.55 - height / targetHeight, 2) * 2;
    }
    return cost;
  }

  function splitRows(images, width, targetHeight) {
    var count = images.length;
    var best = new Array(count + 1);
    best[0] = { cost: 0, previous: -1 };

    for (var end = 2; end <= count; end += 1) {
      for (var length = 2; length <= 5 && length <= end; length += 1) {
        var start = end - length;
        if (!best[start]) continue;
        var candidate = images.slice(start, end);
        var cost = best[start].cost + rowCost(candidate, width, targetHeight);
        if (!best[end] || cost < best[end].cost) {
          best[end] = { cost: cost, previous: start };
        }
      }
    }

    if (!best[count]) return [images];
    var rows = [];
    var cursor = count;
    while (cursor > 0) {
      var previous = best[cursor].previous;
      rows.unshift(images.slice(previous, cursor));
      cursor = previous;
    }
    return rows;
  }

  function appendRow(gallery, images, width, targetHeight) {
    var row = document.createElement('div');
    var ratioSum = images.reduce(function (sum, image) {
      return sum + imageRatio(image);
    }, 0);
    var idealHeight = rowHeight(images, width);
    var renderedHeight = Math.min(idealHeight, targetHeight * 2);

    row.className = 'post-justified-gallery-row';
    images.forEach(function (image) {
      image.style.width = (renderedHeight * imageRatio(image)) + 'px';
      image.style.height = renderedHeight + 'px';
      row.appendChild(image);
    });

    var occupiedWidth = renderedHeight * ratioSum + GAP * (images.length - 1);
    if (occupiedWidth < width - 1) row.style.justifyContent = 'center';
    gallery.appendChild(row);
  }

  function layoutGallery(gallery) {
    var images = Array.prototype.slice.call(gallery.querySelectorAll('img'));
    var width = gallery.clientWidth;
    if (!images.length || width < 1) return;

    images.forEach(function (image) {
      image.style.removeProperty('width');
      image.style.removeProperty('height');
    });
    gallery.textContent = '';

    var targetHeight = targetRowHeight(width);
    var rows = splitRows(images, width, targetHeight);
    rows.forEach(function (rowImages) {
      appendRow(gallery, rowImages, width, targetHeight);
    });
    gallery.classList.add('is-ready');
  }

  function makeGallery(block, images) {
    var gallery = document.createElement('div');
    gallery.className = 'post-justified-gallery';
    gallery.setAttribute('role', 'group');
    gallery.setAttribute('aria-label', '文章图片，共' + images.length + '张');
    images.forEach(function (image) { gallery.appendChild(image); });
    block.parentNode.replaceChild(gallery, block);

    Promise.all(images.map(waitForImage)).then(function () {
      layoutGallery(gallery);
      var frame = 0;
      var relayout = function () {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(function () { layoutGallery(gallery); });
      };
      if ('ResizeObserver' in window) {
        new ResizeObserver(relayout).observe(gallery);
      } else {
        window.addEventListener('resize', relayout, { passive: true });
      }
    });
  }

  function initJustifiedGalleries(root) {
    var roots = typeof root === 'string'
      ? Array.prototype.slice.call(document.querySelectorAll(root))
      : (root && root.nodeType === 1 ? [root] : Array.prototype.slice.call(document.querySelectorAll('.post-content, .cm-memo-content')));

    roots.forEach(function (content) {
      Array.prototype.forEach.call(content.querySelectorAll('p'), function (block) {
        var images = directVisibleImages(block);
        if (images.length > 1 && isImageOnlyBlock(block)) makeGallery(block, images);
      });
    });
  }

  window.PostGallery = { init: initJustifiedGalleries };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initJustifiedGalleries(); });
  } else {
    initJustifiedGalleries();
  }
}());
