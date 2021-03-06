var Dicer = require('..');
var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    inspect = require('util').inspect;

var FIXTURES_ROOT = __dirname + '/fixtures/';

var t = 0,
    group = path.basename(__filename, '.js') + '/';

var tests = [
  { source: 'nested',
    opts: { boundary: 'AaB03x' },
    chsize: 32,
    nparts: 2,
    what: 'One nested multipart'
  },
  { source: 'many',
    opts: { boundary: '----WebKitFormBoundaryWLHCs9qmcJJoyjKR' },
    chsize: 16,
    nparts: 7,
    what: 'Many parts'
  },
  { source: 'many',
    opts: { boundary: 'LOLOLOL' },
    chsize: 16,
    nparts: 0,
    shouldError: true,
    what: 'Many parts, bad boundary'
  },
  { source: 'nested-full',
    opts: { boundary: 'AaB03x', headerFirst: true },
    chsize: 32,
    nparts: 2,
    what: 'One nested multipart with preceding header'
  },
];

function next() {
  if (t === tests.length)
    return;
  var v = tests[t],
      fd,
      n = 0,
      buffer = new Buffer(v.chsize),
      state = { done: false, parts: [], preamble: undefined };

  fd = fs.openSync(FIXTURES_ROOT + v.source + '/original', 'r');

  var dicer = new Dicer(v.opts), error, finishes = 0;

  dicer.on('preamble', function(p) {
    var preamble = { body: undefined, bodylen: 0, header: undefined };

    p.on('header', function(h) {
      preamble.header = h;
    });
    p.on('data', function(data) {
      // make a copy because we are using readSync which re-uses a buffer ...
      var copy = new Buffer(data.length);
      data.copy(copy);
      data = copy;
      if (!preamble.body)
        preamble.body = [ data ];
      else
        preamble.body.push(data);
      preamble.bodylen += data.length;
    });
    p.on('end', function() {
      if (preamble.body)
        preamble.body = Buffer.concat(preamble.body, preamble.bodylen);
      if (preamble.body || preamble.header)
        state.preamble = preamble;
    });
  });
  dicer.on('part', function(p) {
    var part = { body: undefined, bodylen: 0, header: undefined };

    p.on('header', function(h) {
      part.header = h;
    });
    p.on('data', function(data) {
      // make a copy because we are using readSync which re-uses a buffer ...
      var copy = new Buffer(data.length);
      data.copy(copy);
      data = copy;
      if (!part.body)
        part.body = [ data ];
      else
        part.body.push(data);
      part.bodylen += data.length;
    });
    p.on('end', function() {
      if (part.body)
        part.body = Buffer.concat(part.body, part.bodylen);
      state.parts.push(part);
    });
  })
  .on('error', function(err) {
    error = err;
  })
  .on('finish', function() {
    assert(finishes++ === 0, makeMsg(v.what, 'finish emitted multiple times'));

    if (v.shouldError)
      assert(error !== undefined, makeMsg(v.what, 'Expected error'));
    else
      assert(error === undefined, makeMsg(v.what, 'Unexpected error'));

    var preamble;
    if (fs.existsSync(FIXTURES_ROOT + v.source + '/preamble')) {
      var prebody = fs.readFileSync(FIXTURES_ROOT + v.source + '/preamble');
      if (prebody.length) {
        preamble = {
          body: prebody,
          bodylen: prebody.length,
          header: undefined
        };
      }
    }
    if (fs.existsSync(FIXTURES_ROOT + v.source + '/preamble.header')) {
      var prehead = JSON.parse(fs.readFileSync(FIXTURES_ROOT + v.source
                                               + '/preamble.header', 'binary'));
      if (!preamble) {
        preamble = {
          body: undefined,
          bodylen: 0,
          header: prehead
        };
      }
    }

    assert.deepEqual(state.preamble,
                     preamble,
                     makeMsg(v.what,
                      'Preamble mismatch:\nActual:'
                      + inspect(state.preamble)
                      + '\nExpected: '
                      + inspect(preamble)));

    assert.equal(state.parts.length,
                 v.nparts,
                 makeMsg(v.what,
                  'Part count mismatch:\nActual: '
                  + state.parts.length
                  + '\nExpected: '
                  + v.nparts));

    for (var i = 0, header, body; i < v.nparts; ++i) {
      body = fs.readFileSync(FIXTURES_ROOT + v.source + '/part' + (i+1));
      if (body.length === 0)
        body = undefined;
      assert.deepEqual(state.parts[i].body,
                       body,
                       makeMsg(v.what, 'Part #' + (i+1) + ' body mismatch'));
      header = undefined;
      if (fs.existsSync(FIXTURES_ROOT + v.source + '/part' + (i+1) + '.header')) {
        header = fs.readFileSync(FIXTURES_ROOT + v.source
                                 + '/part' + (i+1) + '.header', 'binary');
        header = JSON.parse(header);
      }
      assert.deepEqual(state.parts[i].header,
                       header,
                       makeMsg(v.what,
                        'Part #' + (i+1)
                        + ' parsed header mismatch:\nActual: '
                        + inspect(state.parts[i].header)
                        + '\nExpected: '
                        + inspect(header)));
    }
    ++t;
    next();
  });

  while (true) {
    n = fs.readSync(fd, buffer, 0, buffer.length, null);
    if (n === 0) {
      dicer.end();
      break;
    }
    dicer.write(n === buffer.length ? buffer : buffer.slice(0, n));
  }
  fs.closeSync(fd);
}
next();

function makeMsg(what, msg) {
  return '[' + group + what + ']: ' + msg;
}

process.on('exit', function() {
  assert(t === tests.length, 'Only ran ' + t + '/' + tests.length + ' tests');
});