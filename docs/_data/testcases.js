/**
 * author: Pieter Heyvaert (pheyvaer.heyvaert@ugent.be)
 * Ghent University - imec - IDLab
 */

const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const N3 = require('n3');
const Q = require('q');
const fs = require('fs');
const https = require('https');

module.exports = async () => {
  const result = await getTestCases('../metadata.nt');

  return result;
};

async function getTestCases(path) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromFile(path);
  const engine = newEngine();
  const testcases = [];

  engine.query(`SELECT * {
     ?s a <http://www.w3.org/ns/earl#TestCase>;
        <http://schema.org/name> ?name;
        <http://schema.org/description> ?description;
        <http://rml.io/ns/test-case/rules> ?rules;
        <http://purl.org/dc/terms/identifier> ?id;
        <http://rml.io/ns/test-case/hasError> ?error;
        <http://example.com/dataFormat> ?dataFormat;
        <http://example.com/referenceFormulation> ?refFor.
        
     MINUS {?s <http://example.com/dataFormat> "RDF"} .
  }`,
    {sources: [{type: 'rdfjsSource', value: rdfjsSource}]})
    .then(function (result) {
      result.bindingsStream.on('data', async function (data) {
        data = data.toObject();

        testcases.push({
          iri:  data['?s'].value,
          title: data['?name'].value,
          description: data['?description'].value,
          rules: data['?rules'].value,
          rulesStr: (await _getHTTP(data['?rules'].value)).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
          id: data['?id'].value,
          errorExpected: data['?error'].value,
          dataFormat: data['?dataFormat'].value,
          referenceFormulation: data['?refFor'].value
        });
      });

      result.bindingsStream.on('end', function () {
        testcases.sort( (a, b) => {
          if (a.id > b.id) {
            return 1;
          } else {
            return -1;
          }
        });

        deferred.resolve(testcases);
      });
    });

  return deferred.promise;
}

/**
 * This method returns an RDFJSSource of an file
 * @param {string} path: path of the file
 * @returns {Promise}: a promise that resolve with the corresponding RDFJSSource
 */
function getRDFjsSourceFromFile(path) {
  const deferred = Q.defer();

  fs.readFile(path, 'utf-8', (err, data) => {
    if (err) deferred.reject(err);

    const parser = N3.Parser();
    const store = N3.Store();

    parser.parse(data, (err, quad, prefixes) => {
      if (err) {
        console.error(err);
        deferred.reject(err);
      } else if (quad) {
        store.addQuad(quad);
      } else {
        const source = {
          match: function (s, p, o, g) {
            return require('streamify-array')(store.getQuads(s, p, o, g));
          }
        };

        deferred.resolve(source);
      }
    });
  });

  return deferred.promise;
}

function _getHTTP(url) {
  const deferred = Q.defer();

  https.get(url, (res) => {
    const { statusCode } = res;

    let error;
    if (statusCode !== 200) {
      console.log(url);
      error = new Error('Request Failed.\n' +
        `Status Code: ${statusCode}`);
    }

    if (error) {
      console.error(error.message);
      // consume response data to free up memory
      res.resume();
      return;
    }

    res.setEncoding('utf8');
    let rawData = '';
    res.on('data', (chunk) => { rawData += chunk; });
    res.on('end', () => {
      try {
        deferred.resolve(rawData);
      } catch (e) {
        console.error(e.message);
      }
    });
  }).on('error', (e) => {
    console.error(`Got error: ${e.message}`);
  });

  return deferred.promise;
}
