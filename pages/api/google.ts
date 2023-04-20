import { NextApiRequest, NextApiResponse } from 'next';

import { OPENAI_API_HOST } from '@/utils/app/const';
import { ensureHasValidSession } from '@/utils/server/auth';
import { getTiktokenEncoding } from '@/utils/server/tiktoken';
import { cleanSourceText } from '@/utils/server/webpage';

import { Message, ChatBody } from '@/types/chat';
import { GoogleBody, GoogleSource } from '@/types/google';

import { Tiktoken } from '@dqbd/tiktoken/lite/init';
import { Readability } from '@mozilla/readability';
import endent from 'endent';
import jsdom, { JSDOM } from 'jsdom';
import path from 'node:path';
import { Collection, Document } from 'mongodb';
import { connectToDatabase } from '@/utils/mongoConnect';

async function executeGeneratedQuery(queryString: string, collection: Collection<Document>) {
  queryString = queryString.replace("__COLLECTION__", "collection");
  const queryFunction = new Function("collection", `return ${queryString}`);
  return await queryFunction(collection);
}

const handler = async (req: NextApiRequest, res: NextApiResponse<any>) => {
  // Vercel Hack
  // https://github.com/orgs/vercel/discussions/1278
  // eslint-disable-next-line no-unused-vars
  const vercelFunctionHack = path.resolve('./public', '');

  if (!(await ensureHasValidSession(req, res))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let encoding: Tiktoken | null = null;
  try {
    const {messages, key, model} =
      req.body as ChatBody;

    encoding = await getTiktokenEncoding(model.id);

    const userMessage = messages[messages.length - 1];
    console.log('hi')
    const answerPrompt = endent`
    Generate a MongoDB query in JavaScript using the following question and for db._test provided schema:

    Question:
    ${userMessage.content.trim()}

    Schema:
    Database: 'financials', collection: '_test'
    {
        id ObjectId
        channel string
        sales_team string
        platform string
        strategy string
        inflows double
        outflows double
        netflows double
        aum double
        revenue double
        financials_date date
    }
    `;

    const answerMessage: Message = { role: 'user', content: answerPrompt };

    const answerRes = await fetch(`${OPENAI_API_HOST}/v1/chat/completions`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key ? key : process.env.OPENAI_API_KEY}`,
        ...(process.env.OPENAI_ORGANIZATION && {
          'OpenAI-Organization': process.env.OPENAI_ORGANIZATION,
        }),
      },
      method: 'POST',
      body: JSON.stringify({
        model: model.id,
        messages: [
          {
            role: 'system',
            content: `You are an expert database engineer and data scientist. Return your responses only in code.`,
          },
          answerMessage,
        ],
        max_tokens: 1000,
        temperature: 1,
        stream: false,
      }),
    });

    const { choices: choices2 } = await answerRes.json();
    const codeAnswer = choices2[0].message.content;
    console.log("Code Answer:", codeAnswer);
    let trimmedCodeAnswer = '';
    const codeStart = '```';
    const codeEnd = '```';

    if (codeAnswer.includes(codeStart) && codeAnswer.includes(codeEnd)) {
      trimmedCodeAnswer = codeAnswer.split(codeStart)[1].split(codeEnd)[0].trim();
    } else {
      // Handle cases where the output format is not as expected
      console.error('Unexpected GPT-4 output format');
      res.status(500).json({ error: 'Unexpected GPT-4 output format' });
      return;
    }
    // Replace the 'db._test' reference with a placeholder
    trimmedCodeAnswer = trimmedCodeAnswer.replaceAll("JavaScript", "").trim();
    trimmedCodeAnswer = trimmedCodeAnswer.replaceAll("javascript", "").trim();
    trimmedCodeAnswer = trimmedCodeAnswer.replaceAll("ISODate", "Date");

    trimmedCodeAnswer = trimmedCodeAnswer.replace("db._test", "__COLLECTION__");
    trimmedCodeAnswer = trimmedCodeAnswer.replace("db.financials", "__COLLECTION__");
    console.log("Generated query:", trimmedCodeAnswer);

    // Execute the generated query
    const db = await connectToDatabase();

    const testCollection = db.collection('_test');

    const result = await executeGeneratedQuery(trimmedCodeAnswer, testCollection);

    // Retrieve the actual data from the cursor
    const data = [];
    for await (const doc of result) {
      data.push(doc);
    }
    const dataPrompt = `Given the following data:\n\n${JSON.stringify(
        data,
        null,
        2
    )}\n\nPlease provide a key takeaway and represent the data in a markdown table.`;
    const dataMessage: Message = { role: 'user', content: dataPrompt };
    const dataRes = await fetch(`${OPENAI_API_HOST}/v1/chat/completions`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key ? key : process.env.OPENAI_API_KEY}`,
          ...(process.env.OPENAI_ORGANIZATION && {
            'OpenAI-Organization': process.env.OPENAI_ORGANIZATION,
          }),
        },
        method: 'POST',
        body: JSON.stringify({
          model: model.id,
          messages: [
            {
              role: 'system',
              content: `You are an expert database engineer and data scientist. Return your responses only in code.`,
            },
            dataMessage,
          ],
          max_tokens: 1000,
          temperature: 1,
          stream: false,
        }),
      });

    const { choices: choices3 } = await dataRes.json();
    const answer = choices3[0].message.content;

    res.status(200).json({ answer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error' });
  } finally {
    if (encoding !== null) {
      encoding.free();
    }
  }
};

export default handler;

//   try {
//     const { messages, key, model, googleAPIKey, googleCSEId } =
//       req.body as GoogleBody;

//     encoding = await getTiktokenEncoding(model.id);

//     const userMessage = messages[messages.length - 1];
//     const query = encodeURIComponent(userMessage.content.trim());

//     const googleRes = await fetch(
//       `https://customsearch.googleapis.com/customsearch/v1?key=${
//         googleAPIKey ? googleAPIKey : process.env.GOOGLE_API_KEY
//       }&cx=${
//         googleCSEId ? googleCSEId : process.env.GOOGLE_CSE_ID
//       }&q=${query}&num=5`,
//     );

//     const googleData = await googleRes.json();

//     const sources: GoogleSource[] = googleData.items.map((item: any) => ({
//       title: item.title,
//       link: item.link,
//       displayLink: item.displayLink,
//       snippet: item.snippet,
//       image: item.pagemap?.cse_image?.[0]?.src,
//       text: '',
//     }));

//     const textDecoder = new TextDecoder();
//     const sourcesWithText: any = await Promise.all(
//       sources.map(async (source) => {
//         try {
//           const timeoutPromise = new Promise((_, reject) =>
//             setTimeout(() => reject(new Error('Request timed out')), 5000),
//           );

//           const res = (await Promise.race([
//             fetch(source.link),
//             timeoutPromise,
//           ])) as any;

//           // if (res) {
//           const html = await res.text();

//           const virtualConsole = new jsdom.VirtualConsole();
//           virtualConsole.on('error', (error) => {
//             if (!error.message.includes('Could not parse CSS stylesheet')) {
//               console.error(error);
//             }
//           });

//           const dom = new JSDOM(html, { virtualConsole });
//           const doc = dom.window.document;
//           const parsed = new Readability(doc).parse();

//           if (parsed) {
//             let sourceText = cleanSourceText(parsed.textContent);

//             // 400 tokens per source
//             let encodedText = encoding!.encode(sourceText);
//             if (encodedText.length > 400) {
//               encodedText = encodedText.slice(0, 400);
//             }
//             return {
//               ...source,
//               text: textDecoder.decode(encoding!.decode(encodedText)),
//             } as GoogleSource;
//           }
//           // }

//           return null;
//         } catch (error) {
//           console.error(error);
//           return null;
//         }
//       }),
//     );

//     const filteredSources: GoogleSource[] = sourcesWithText.filter(Boolean);
//     let sourceTexts: string[] = [];
//     let tokenSizeTotal = 0;
//     for (const source of filteredSources) {
//       const text = endent`
//       ${source.title} (${source.link}):
//       ${source.text}
//       `;
//       const tokenSize = encoding.encode(text).length;
//       if (tokenSizeTotal + tokenSize > 2000) {
//         break;
//       }
//       sourceTexts.push(text);
//       tokenSizeTotal += tokenSize;
//     }

//     const answerPrompt = endent`
//     Provide me with the information I requested. Use the sources to provide an accurate response. Respond in markdown format. Cite the sources you used as a markdown link as you use them at the end of each sentence by number of the source (ex: [[1]](link.com)). Provide an accurate response and then stop. Today's date is ${new Date().toLocaleDateString()}.

//     Example Input:
//     What's the weather in San Francisco today?

//     Example Sources:
//     [Weather in San Francisco](https://www.google.com/search?q=weather+san+francisco)

//     Example Response:
//     It's 70 degrees and sunny in San Francisco today. [[1]](https://www.google.com/search?q=weather+san+francisco)

//     Input:
//     ${userMessage.content.trim()}

//     Sources:
//     ${sourceTexts}

//     Response:
//     `;

//     const answerMessage: Message = { role: 'user', content: answerPrompt };

//     const answerRes = await fetch(`${OPENAI_API_HOST}/v1/chat/completions`, {
//       headers: {
//         'Content-Type': 'application/json',
//         Authorization: `Bearer ${key ? key : process.env.OPENAI_API_KEY}`,
//         ...(process.env.OPENAI_ORGANIZATION && {
//           'OpenAI-Organization': process.env.OPENAI_ORGANIZATION,
//         }),
//       },
//       method: 'POST',
//       body: JSON.stringify({
//         model: model.id,
//         messages: [
//           {
//             role: 'system',
//             content: `Use the sources to provide an accurate response. Respond in markdown format. Cite the sources you used as [1](link), etc, as you use them. Maximum 4 sentences.`,
//           },
//           answerMessage,
//         ],
//         max_tokens: 1000,
//         temperature: 1,
//         stream: false,
//       }),
//     });

//     const { choices: choices2 } = await answerRes.json();
//     const answer = choices2[0].message.content;

//     res.status(200).json({ answer });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: 'Error' });
//   } finally {
//     if (encoding !== null) {
//       encoding.free();
//     }
//   }
// };

// export default handler;
