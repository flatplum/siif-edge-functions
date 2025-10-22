// The main entrypoint for the notion-integration edge function
// Copyright (C) 2025 flatplum

import { Client, iteratePaginatedAPI } from "@notionhq/client";
import { PageObjectResponse, DatabaseObjectResponse, DataSourceObjectResponse, BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import dotenv from 'dotenv';

dotenv.config();

const NOTION_INTEGRATION_KEY = process.env.NOTION_INTEGRATION_KEY
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID

// Initializing a client
// If we don't find a key, exit
if (!NOTION_INTEGRATION_KEY) {
  console.log("No integration key given.")
  process.exit(1); 
}

const notion = new Client({
  auth: NOTION_INTEGRATION_KEY
});

// const annotationToTag = {
//   bold: "b",
//   italic: "i",
//   strikethrough: "s",
//   underline: "u",
//   code: "code"
// };
// const typeToTag = {
//   heading_1: "h1",
//   heading_2: "h2",
//   paragraph: "p"
// };

// const getPlainTextFromRichText = (richText)=>{
//   return richText.map((t)=>{
//     let htmlText = t.plain_text;
//     Object.entries(t.annotations).forEach(([k, v])=>{
//       if (!v) { return }
//       if (k == "color") { return }

//       const tag = annotationToTag[k];
//       htmlText = `<${tag}>${htmlText}</${tag}>`;
//     });
//     return htmlText;
//   }).join("");
//   // Note: A page mention will return "Undefined" as the page name if the page has not been shared with the integration. See: https://developers.notion.com/reference/block#mention
// };

async function retrieveBlockChildren(id) {
  // console.log("Retrieving blocks (async)...");
  const blocks: BlockObjectResponse[] = [];
  // Use iteratePaginatedAPI helper function to get all blocks first-level blocks on the page
  for await (const block of iteratePaginatedAPI(notion.blocks.children.list, {
    block_id: id
  })){
    if (!("type" in block)) { continue }
    blocks.push(block);
  }
  return blocks;
}

async function retrieveChildDatabase(id) {

}

// const getTextFromBlock = (block)=>{
//   const tag = typeToTag[block.type];
//   let text;
//   // Get rich text from blocks that support it
//   if (block[block.type].rich_text) {
//     // This will be an empty string if it's an empty line.
//     text = getPlainTextFromRichText(block[block.type].rich_text);
//   } else {
//     switch(block.type){
//       case "unsupported":
//         // The public API does not support all block types yet
//         text = "[Unsupported block type]";
//         break;
//       case "bookmark":
//         text = block.bookmark.url;
//         break;
//       case "child_database":
//         text = block.child_database.title;
//         break;
//       case "child_page":
//         text = block.child_page.title;
//         break;
//       case "embed":
//       case "video":
//       case "file":
//       case "image":
//       // case "pdf":
//       //   text = getMediaSourceText(block)
//       //   break
//       case "equation":
//         text = block.equation.expression;
//         break;
//       case "link_preview":
//         text = block.link_preview.url;
//         break;
//       case "synced_block":
//         // Provides ID for block it's synced with.
//         text = block.synced_block.synced_from ? "This block is synced with a block with the following ID: " + block.synced_block.synced_from[block.synced_block.synced_from.type] : "Source sync block that another blocked is synced with.";
//         break;
//       case "table":
//         // Only contains table properties.
//         // Fetch children blocks for more details.
//         text = "Table width: " + block.table.table_width;
//         break;
//       case "table_of_contents":
//         // Does not include text from ToC; just the color
//         text = "ToC color: " + block.table_of_contents.color;
//         break;
//       case "breadcrumb":
//       case "column_list":
//       case "divider":
//         text = "No text available";
//         break;
//       default:
//         text = "[Needs case added]";
//         break;
//     }
//   }
//   // Blocks with the has_children property will require fetching the child blocks. (Not included in this example.)
//   // e.g. nested bulleted lists
//   if (block.has_children) {
//     // For now, we'll just flag there are children blocks.
//     text = text + " (Has children)";
//   }
//   // Includes block type for readability. Update formatting as needed.
//   return `<${tag}>${text}</${tag}>`;
// };

async function getAllPages(databaseId: string): Promise<PageObjectResponse[]> {
  const pages: PageObjectResponse[] = [];
  let hasMore = true;
  let cursor: string | undefined = undefined;
  while (true) {
    const response = (await notion.dataSources.query({
      data_source_id: databaseId,
      start_cursor: cursor,
      page_size: 100
    }));

    pages.push(...response.results.filter(x => x && x.object == "page" && "properties" in x));

    if (response.next_cursor == null) { return pages }
    hasMore = response.has_more;
    cursor = response.next_cursor;
  }
}

(async () => {
  if (!NOTION_DATABASE_ID) {
    console.log("No database ID found.")
    return
  }

  const websiteDataSourceData = (await notion.databases.retrieve({
    database_id: NOTION_DATABASE_ID
  }))
  if (!("data_sources" in websiteDataSourceData)) { return }
  const websiteDataSourceId = websiteDataSourceData.data_sources[0].id
  const websiteDataSourcePages = Object.fromEntries((await getAllPages(websiteDataSourceId))
    .map(x => {
      const name = x.properties.Name
      if (name.type != "title") { return }
      return [name.title[0].plain_text, x.id]
    })
    .filter((x): x is [string, string] => Array.isArray(x) && x.length === 2)
  )
  
  // // We're only implementing CommitteeData right now
  const blocks = await retrieveBlockChildren(websiteDataSourcePages.CommitteeData);
  const committee2025Block = blocks.filter(x => x.type == "child_database").find(x => x.child_database.title == "Committees By Year")
  if (committee2025Block == undefined) {
    console.log("Could not find committee block.")
    return
  }
  const committee2025Database = await notion.databases.retrieve({
    database_id: committee2025Block.id
  })
  if (!("title" in committee2025Database)) { return }
  const committee2025TeamDatabases = (await retrieveBlockChildren((await getAllPages(committee2025Database.data_sources[0].id))[0].id))
    .filter(x => x.type == "child_database")
  console.log(committee2025TeamDatabases)
  // console.log(committee2025DataSource)

  // console.log(peepee)
  // const articleID = "292749b9b6198063bbdf000c033c4669";
  // // console.log(articleID);
  // const pages = await getAllPages(articleID);
  // const pagesMetadata = await Promise.all(pages.map(async (p)=>{
  //   const blocks = await retrieveBlockChildren(p.id);
  //   // return {
  //   //   title: p.properties.Name.title[0].plain_text,
  //   //   html: blocks.map(getTextFromBlock).join("")
  //   // };
  //   return blocks.map(getTextFromBlock).join("");
  // }));
  // console.log(pagesMetadata)
})();
