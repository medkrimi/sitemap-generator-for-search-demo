/* eslint-disable @typescript-eslint/no-unused-vars */
// extractor function for use with an advanced JS document extractor
function extract(request, response) {
    $ = response.body;

    var url = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || response.url;

    var regex = /^https?:\/\/[^\/]+\/([^?\/#]+)\//g;
    var p = regex.exec(url);
    var page_type = $('meta[property="og:type"]').attr('content') || (p != null ? p[1] : 'website_content');
    page_type = titleCased(page_type);

    var image_url = $('meta[property="og:image"]').attr('content');
    if (!image_url) {
      var img = $('div.container-main img, div.location-details img, div.blog-content img, div.promo-content-section img').filter(function () {
        var src = $(this).attr('src') || $(this).attr('data-src') || '';
        return src && !/logo|icon|sprite|favicon|pixel|spacer|mega-promo/i.test(src);
      }).first();
      image_url = img.attr('src') || img.attr('data-src');
    }
    if (image_url) {
      image_url = addBaseURL(image_url);
    }

    var desc;
    var blog = $('div.blog-content');
    if (blog.length) {
      desc = concatText(blog).replace(/\s+/g, ' ').trim();
    } else {
      var chunks = [];
      var location = $('div.location-details div.location-content');
      if (location.length) {
        chunks.push(concatText(location));
      }
      var hero = $('div.container-main div.hero-content.white-color, div.event-hero div.hero-content.white-color');
      if (hero.length) {
        chunks.push(concatText(hero));
      }
      $('div.heading-inner div.heading-content, div.promo-content-section, div.rte-inner.rte-headings, div.col-lg-12 div.accordion div.accordion-section').each(function () {
        var t = $(this).text().replace(/\s+/g, ' ').trim();
        if (t) chunks.push(t);
      });
      desc = chunks.join(' ').replace(/\s+/g, ' ').trim();
    }

    var name = $('meta[property="og:title"]').attr('content') || $('meta[name="title"]').attr('content') || $('meta[name="searchtitle"]').attr('content') || $('title').text();
    name = String(name || '').replace(/\s+/g, ' ').trim();

    if (!desc || desc.length < 80) {
      desc = desc || $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
    }
    if (!desc || desc.length < 80) {
      desc = [name, $('h1.hero-main-title, h1.blog-header-title').first().text()].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    return [{
      'description': desc,
      'name': name,
      'type': page_type,
      'url': url,
      'image_url': image_url || 'https://www.midflorida.com/-/media/feature/midflorida/siteasset/logo-new.svg'
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
    if (url.startsWith('/')) return 'https://www.midflorida.com' + url;
    return 'https://www.midflorida.com/' + url;
  }

  function concatText(elements){
    return elements.map((index, element) => $(element).text()).get().join(' ');
  }
