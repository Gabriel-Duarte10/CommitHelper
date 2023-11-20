import * as vscode from 'vscode';
import { exec } from 'child_process';
import OpenAI from "openai";
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "commithelper" is now active!');

    let commitMessageCommand = vscode.commands.registerCommand('commithelper.helloWorld', async () => {
        try {
			// let apiKey = await getApiKey(context.secrets);
			let apiKey = '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';
            if (!apiKey) {
                // apiKey = await promptForApiKey(context.secrets);
                if (!apiKey) {
                    vscode.window.showErrorMessage('API Key é necessária para continuar.');
                    return;
                }
            }
            const openai = new OpenAI({ apiKey });
            let workspacePath = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
			if (!workspacePath) {
				vscode.window.showErrorMessage('Nenhum workspace aberto');
				return;
			}
			await prepararAlteracoes(workspacePath);
            let mudancas = await obterMudancasNaoComitadas(workspacePath);
            let descricaoMudancas = await processarMudancas(apiKey, mudancas, workspacePath);
        	let respostaChatGPT = await tentarEnviarParaChatGPT(apiKey, descricaoMudancas);
            vscode.window.showInformationMessage('Mensagem de commit sugerida: ' + respostaChatGPT);
        } catch (error: any) {
            vscode.window.showErrorMessage('Erro: ' + error.message);
        }
    });

    context.subscriptions.push(commitMessageCommand);
}

async function prepararAlteracoes(workspacePath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		exec('git add .', { cwd: workspacePath }, (err, stdout, stderr) => {
			if (err) {
				reject(err);
				return;
			}
			resolve();
		});
	});
}

async function obterMudancasNaoComitadas(workspacePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec('git diff --name-status --cached', { cwd: workspacePath }, (err, stdout, stderr) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(stdout);
        });
    });
}

async function processarMudancas(apiKey: string, mudancas: string, workspacePath: string): Promise<string> {
    const linhas = mudancas.split('\n');
    let textoParaChatGPT = '';

    for (const linha of linhas) {
        if (linha) {
            const [status, arquivo] = linha.split(/\s+/);
            if (status === 'A' || status === 'D') {
				let conteudoArquivo = await lerConteudoArquivo(path.join(workspacePath, arquivo), status, workspacePath);
				textoParaChatGPT += `Arquivo ${arquivo} ${status === 'A' ? 'adicionado' : 'removido'}:\n${conteudoArquivo}\n\n`;
			}
        }
    }

    return textoParaChatGPT;
}

async function lerConteudoArquivo(caminhoArquivo: string, status: string, workspacePath: string): Promise<string> {
    if (status === 'D') {
        const caminhoRelativo = path.relative(workspacePath, caminhoArquivo).replace(/\\/g, '/');
        return new Promise((resolve, reject) => {
            exec(`git show HEAD:${caminhoRelativo}`, { cwd: workspacePath }, (err, stdout, stderr) => {
                if (err) {
                    reject('Não foi possível recuperar o arquivo deletado: ' + caminhoRelativo + ' Erro: ' + err.message);
                    return;
                }
                resolve(stdout);
            });
        });
    }else {
        // O arquivo foi adicionado ou modificado, leia o conteúdo atual
        return new Promise((resolve, reject) => {
            fs.readFile(caminhoArquivo, 'utf8', (err, data) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(data);
            });
        });
    }
}

async function tentarEnviarParaChatGPT(apiKey: string, texto: string): Promise<string> {
    let modelos = [
		"gpt-3.5-turbo-0613",
	];
	
    for (let modelo of modelos) {
        try {
            return await enviarParaChatGPT(apiKey, texto, modelo);
        } catch (error : any) {
            if (error.message.includes("429")) {
                console.log(`Erro 429 com modelo ${modelo}. Tentando com o próximo modelo.`);
                
            }
            continue;
        }
    }
    return 'Não foi possível gerar a mensagem de commit.';
}
async function enviarParaChatGPT(apiKey: string, texto: string, modelo: string): Promise<string> {
    const openai = new OpenAI({ apiKey });
    const prompt = `Descreva de forma curta para um commit o seguinte:\n\n${texto}`;
    const response = await openai.chat.completions.create({
        messages: [
                   { role: "user", content: "oi" }],
        model: modelo
    });
    return response.choices[0].message.content as string;
}
async function getApiKey(secretStorage: vscode.SecretStorage): Promise<string | undefined> {
    return secretStorage.get('openaiApiKey');
}

async function promptForApiKey(secretStorage: vscode.SecretStorage): Promise<string | undefined> {
    const apiKey = await vscode.window.showInputBox({
        prompt: 'Insira a API Key do OpenAI',
        ignoreFocusOut: true,
        password: true // Faz com que o texto inserido seja ocultado
    });

    if (apiKey) {
        await secretStorage.store('openaiApiKey', apiKey);
    }

    return apiKey;
}

export function deactivate() {}
