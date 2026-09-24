## Sitemap Generator for Sitecore Search

The purpose of this project is to accomplish 2 things:
- Take a sitemap.xml from a customer's website and generate a truncated version for quick interation and integration
- Generate an advanced extractor JS to use with Sitecore Search

## Setup

If you plan to use everything via the app, copy and rename the .env.example to .env.local, and provide your own Cursor API key. You can get generate your own key from [Dashboard - API & SSH Keys](https://cursor.com/dashboard/api).

Start the application using:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Usage

- Provide the URL for a sitemap.xml file.
- Set the Subset Size to a number greater than 1.
- Click Generate Subset.

### What's Happening Now?

The application is grabbing the sitemap, and trimming it to only include your subset size number of URLs for each unique directory path, and then saving it as a new file locally in the app at /public/generated_sitemaps/.

## ...and then?

Now a Step 2 will appear! This will allow you to invoke a Cursor Skill to generate a custom extractor based off 10 random URLs from the generated sitemap, and then provide validation reports for some URLs to verify what will be extracted by Sitecore Search. This file will also be saved at /public/generated_extractors/.

If you do not want to provide a Cursor API key in the environment variables, you can also invoke the skill through the Cursor IDE by typing ``/generate-extractor`` in an Agent chat. This will default to using the most recently created sitemap file, and provide similar reporting on validation.

## ok. Now what?

Now we just have to take what we have and go to the CEC in Sitecore Search.

- Push your changes back up to GitHub
- Navigate to your repo, and ``/public/generated_sitemaps/[most recent file].xml``, click the `RAW` button in the file utility navigation. Copy this URL
- In Sitecore Search, create a new Source. Use your RAW sitemap URL from your repo as the sitemap for the source
- For the Document Extractor, choose Web Crawler (Advanced), and use the generated extractor JS as your extractor function.