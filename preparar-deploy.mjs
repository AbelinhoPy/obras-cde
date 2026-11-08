import fs from 'node:fs';

const filesToDeploy = [
  'package.json',
  'vercel.json',
  'api/db.js',
  'api/resumen.js',
  'api/acciones.js',
  'api/webhook-whatsapp.js',
  'public/index.html'
];

const inlinedFiles = filesToDeploy.map(file => {
  const content = fs.readFileSync(file, 'utf8');
  return {
    file,
    data: content,
    encoding: 'utf-8'
  };
});

const payload = {
  name: 'obras-cde',
  project: 'prj_6UuSLtEmsflaobroGIV8RHZml9AP',
  target: 'production',
  files: inlinedFiles
};

fs.writeFileSync('deploy-body.json', JSON.stringify(payload, null, 2), 'utf8');
fs.writeFileSync('files-for-mcp.json', JSON.stringify({
  teamId: 'team_dAevPAfcKAGZXA6TaZb6ZUFD',
  requestBody: payload
}, null, 2), 'utf8');

console.log('Deploy payload listo. Total archivos:', inlinedFiles.length);
