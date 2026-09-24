/* eslint-disable @typescript-eslint/no-unused-vars */
// extractor function for use with an advanced JS document extractor
function extract(request, response) {
    $ = response.body;

    // url: canonical URL of the page (og:url, then link rel=canonical, then request URL)
    var url = $('meta[property="og:url"]').attr('content') || $('link[rel="canonical"]').attr('href') || response.url;

    // type: og:type, otherwise first directory in the URL
    var regex = /^https?:\/\/[^\/]+\/([^?\/#]+)\//g;
    var p = regex.exec(url);
    var page_type = $('meta[property="og:type"]').attr('content') || (p != null ? p[1] : 'website_content');
    page_type = titleCased(page_type);

    // image_url: og:image, otherwise first unique (non-logo) image in the page body
    var image_url = $('meta[property="og:image"]').attr('content');
    if (!image_url) {
      var img = $('img.hero-slide__image, .article-header img, #main-content img').filter(function () {
        var src = $(this).attr('src') || $(this).attr('data-src') || '';
        return src && !/logo|icon|sprite|favicon|pixel|spacer/i.test(src);
      }).first();
      image_url = img.attr('src') || img.attr('data-src');
    }
    if (image_url) {
      image_url = addBaseURL(image_url);
    }

    // description: as much body copy as possible from the shared main-column text, then main paragraphs
    var desc;
    var desc1 = $('div.main.col-lg-8 div.text');
    var desc2 = $('#main-content p');
    if (desc1.length > 0 && concatText(desc1).trim()) {
      desc = concatText(desc1).replace(/\s\s+/g, ' ').trim();
    } else if (desc2.length > 0 && concatText(desc2).trim()) {
      desc = concatText(desc2).replace(/\s\s+/g, ' ').trim();
    } else {
      desc = null;
    }

    return [{
      'description': desc || $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || $('h1').first().text(),
      'name': $('meta[property="og:title"]').attr('content') || $('meta[name="title"]').attr('content') || $('meta[name="searchtitle"]').attr('content') || $('title').text(),
      'type': page_type,
      'url': url,
      'image_url': image_url || null
    }];
  }

  function titleCased(sentence){
    return String(sentence || '')
    .replaceAll('-',' ')
    .replaceAll('_',' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  }

  function addBaseURL(url){
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return 'https://www.fultoncountyga.gov' + url;
    return 'https://www.fultoncountyga.gov/' + url;
  }

  function concatText(elements){
    return elements.map((index, element) => $(element).text()).get().join(' ');
  }
