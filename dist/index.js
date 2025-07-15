const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const path = require('path');
const fs = require('fs');

async function run() {
  try {
    const fileBaseName = core.getInput('file_base_name');
    const docsDir = core.getInput('docs_dir');
    const imagesDir = core.getInput('images_dir');
    const templatePathInput = core.getInput('template_path');

    core.info('Action Inputs received:');
    core.info(`  file_base_name: ${fileBaseName}`);
    core.info(`  docs_dir: ${docsDir}`);
    core.info(`  images_dir: ${imagesDir}`);
    core.info(`  template_path: ${templatePathInput}`);

    const constructorRepoOwner = 'yaouDev';
    const constructorRepoName = 'automated-document-constructor';
    const constructorRepoRef = 'main';
    const tempDir = process.env.RUNNER_TEMP || '/tmp';
    const cloneDir = path.join(tempDir, constructorRepoName);

    core.info(`Cloning core constructor repository: ${constructorRepoOwner}/${constructorRepoName}@${constructorRepoRef} into ${cloneDir}`);
    
    await exec.exec('git', [
      'clone',
      `https://github.com/${constructorRepoOwner}/${constructorRepoName}.git`,
      cloneDir,
    ]);

    process.chdir(cloneDir);
    await exec.exec('git', ['checkout', constructorRepoRef]);
    core.info(`Successfully cloned and checked out ${constructorRepoRef} in ${cloneDir}`);

    const currentRepoName = github.context.repo.repo;
    const runNumber = github.context.runNumber;

    const FILE_BASE_NAME_VAR = fileBaseName || currentRepoName;
    const ARTIFACT_DIR_VAR = 'artifacts';
    const DOCS_DIR_VAR = docsDir;
    const IMAGES_DIR_VAR = imagesDir;
    const DEFAULT_TEMPLATE = './templates/template.tex';

    // Step: Set dynamic environment variables
    const VERSIONS_DIR = path.join(ARTIFACT_DIR_VAR, 'versions');
    const CURRENT_DATE = new Date().toISOString().slice(0, 10);
    const RUN_NUMBER = runNumber;

    let FINAL_TEMPLATE_PATH;
    core.info(`Generated version suffix: ${CURRENT_DATE}-${RUN_NUMBER}`);

    // Step: Set (& Download) Template Path
    if (templatePathInput === 'remote_template') {
      core.info("No template was given - downloading default");
      const TEMPLATE_RAW_URL = `https://raw.githubusercontent.com/${constructorRepoOwner}/${constructorRepoName}/main/templates/template.tex`;
      const LOCAL_TEMPLATE_PATH = path.join(tempDir, 'template.tex');

      core.info(`Attempting to download template from: ${TEMPLATE_RAW_URL}`);
      core.info(`Saving template to: ${LOCAL_TEMPLATE_PATH}`);

      try {
        await exec.exec('curl', ['-L', TEMPLATE_RAW_URL, '-o', LOCAL_TEMPLATE_PATH]);
        if (!fs.existsSync(LOCAL_TEMPLATE_PATH)) {
          throw new Error('Downloaded template file not found.');
        }
        core.info(`SUCCESS: Template downloaded and is ready at ${LOCAL_TEMPLATE_PATH}`);
        // Optionally, read and log first few lines
        const templateContent = fs.readFileSync(LOCAL_TEMPLATE_PATH, 'utf8');
        core.info(`First 5 lines of template:\n${templateContent.split('\n').slice(0, 5).join('\n')}`);
        FINAL_TEMPLATE_PATH = LOCAL_TEMPLATE_PATH;
      } catch (error) {
        core.setFailed(`ERROR: Failed to download template. Please double-check the TEMPLATE_RAW_URL. Error: ${error.message}`);
        return; // Exit action on failure
      }
    } else {
      FINAL_TEMPLATE_PATH = templatePathInput || DEFAULT_TEMPLATE;
      core.info(`Using provided template path: ${FINAL_TEMPLATE_PATH}`);
    }

    // Step: Verify Template Path
    if (!fs.existsSync(FINAL_TEMPLATE_PATH)) {
      core.setFailed(`ERROR: Template file NOT found at ${FINAL_TEMPLATE_PATH}!`);
      return; // Exit action on failure
    }
    core.info(`Template file verified: ${FINAL_TEMPLATE_PATH}`);


    // Step: Create artifacts directories
    // Ensure the base artifact directory exists within the cloned repo's context
    fs.mkdirSync(ARTIFACT_DIR_VAR, { recursive: true });
    fs.mkdirSync(VERSIONS_DIR, { recursive: true });
    core.info(`Ensured directory ${VERSIONS_DIR} exists.`);

    // Step: Get list of Markdown files in desired order
    let markdownFilesList = '';
    try {
      const { stdout } = await exec.getExecOutput('find', [DOCS_DIR_VAR, '-name', '*.md', '-print0']);
      // Split by null character and filter out empty strings, then join with spaces
      markdownFilesList = stdout.split('\0').filter(s => s.trim() !== '').sort().join(' ');
      core.info(`Found Markdown files for PDF compilation: ${markdownFilesList}`);
    } catch (error) {
      core.setFailed(`Failed to find markdown files: ${error.message}`);
      return;
    }

    // Step: Install Pandoc and LaTeX
    core.info('Installing Pandoc and LaTeX...');
    await exec.exec('sudo', ['apt-get', 'update']);
    await exec.exec('sudo', ['apt-get', 'install', '-y', 'pandoc', 'texlive-latex-extra', 'texlive-fonts-recommended']);
    core.info('Pandoc and LaTeX installed.');

    // Step: Compile PDF with Pandoc
    const VERSIONED_PDF_FILENAME = `${FILE_BASE_NAME_VAR}-${CURRENT_DATE}-${RUN_NUMBER}.pdf`;
    const VERSIONED_PDF_FULL_PATH = path.join(VERSIONS_DIR, VERSIONED_PDF_FILENAME);
    const LATEST_PDF_FULL_PATH = path.join(ARTIFACT_DIR_VAR, `${FILE_BASE_NAME_VAR}.pdf`);

    core.info(`Compiling PDF as: ${VERSIONED_PDF_FULL_PATH}`);

    const pandocArgs = [
      '--from', 'markdown',
      '--to', 'pdf',
      '--output', VERSIONED_PDF_FULL_PATH,
      '--table-of-contents',
      '--toc-depth=3',
      '--number-sections',
      `--template=${FINAL_TEMPLATE_PATH}`,
      `--variable=date:${CURRENT_DATE}`,
      `--resource-path=./:${IMAGES_DIR_VAR}`,
      ...markdownFilesList.split(' ').filter(s => s.trim() !== '')
    ];

    try {
      await exec.exec('pandoc', pandocArgs);
      core.info('Pandoc compilation successful.');
    } catch (error) {
      core.setFailed(`Pandoc compilation failed: ${error.message}`);
      return;
    }

    fs.copyFileSync(VERSIONED_PDF_FULL_PATH, LATEST_PDF_FULL_PATH);
    core.info(`Copied PDF to ${LATEST_PDF_FULL_PATH}`);

    core.setOutput('pdf_path', VERSIONED_PDF_FULL_PATH);
    core.setOutput('artifact_name', VERSIONED_PDF_FILENAME);

    core.info('Document construction action completed successfully!');

  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

run();
