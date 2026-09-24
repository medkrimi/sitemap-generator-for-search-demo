/* eslint-disable @typescript-eslint/no-unused-vars */
// extractor function for use with an advanced JS document extractor
function extract(request, response) {
    $ = response.body;

    // build the return object
    // description: extract the entire body copy of the page, as plain text, for indexing purposes. The concatText function is here to help string plain text from an array of selected elements that represent the main body copy of the page.
    // name: extract the title of the page, preference to meta og:title, fallback to meta title, fallback to title tag
    // type: extract the type of the page, preference to meta og:type, fallback to hard-coded string
    // url: extract the url of the page, preference to meta og:url, fallback to canonical url
    // image_url: extract the image url of the page, preference to meta og:image, fallback to hard-coded string
    return [{
      'description': $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || $('p').text(),
      'name': $('meta[name="searchtitle"]').attr('content') || $('meta[name="title"]').attr('content') || $('meta[property="og:title"]').attr('content') || $('title').text(),
      'type': $('meta[property="og:type"]').attr('content') || 'Website Content',
      'url': $('meta[property="og:url"]').attr('content') || $('link[rel="canonical"]').attr('href'),
      'image_url': $('meta[property="og:image"]').attr('content') ||  'https://site.com/some-static-image.jpg'
    }];
  }

  // helper function to normalize page type to title case
  function titleCased(sentence){
    return sentence
    .replaceAll('-',' ')                                        // replace hyphens with spaces
    .replaceAll('_',' ')                                        // replace underscores with spaces
    .split(' ')                                                 // split the sentence into an array of words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))  // capitalize the first letter of each word
    .join(' ');                                                 // join the words back into a sentence
  }

  // helper function to add baseURL
  function addBaseURL(url){
    return 'https://site.com' + url;
  }

  // helper function to concat all text from an array of selected elements
  function concatText(elements){
    return elements.map((index, element) => $(element).text()).get().join(' ');
  }