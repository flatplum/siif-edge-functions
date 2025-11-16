// The main entrypoint for the notion-integration edge function
// Copyright (C) 2025 flatplum

import { Client, iteratePaginatedAPI } from "@notionhq/client";
import { PageObjectResponse, BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";
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
  const database = await notion.databases.retrieve({ database_id: id })
  if (!("title" in database)) { return }
  return await getAllPages(database.data_sources[0].id)
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


type flatMetadataItem = {
  _index: number,
  role?: string
  people: {
    name: string
    img: string
    title: string
    order: string
    // _index: number
  }[]
}

type committeeMetadataType = {
  [key: string]: flatMetadataItem
}


(async () => {
  const USER_YEAR_QUERY = "2026 Sem 1"
  let htmlOutput: string = ""
  let committeeMetadata: committeeMetadataType = {}
  let committeePage: PageObjectResponse | undefined

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
  
  // We're only implementing CommitteeData right now
  // The Notion API sucks so I'll extensively employ comments
  //
  // This retrieves the "Commitees By Year" database
  const blocks = await retrieveBlockChildren(websiteDataSourcePages.CommitteeData);
  const commByYearBlock = blocks.filter(x => x.type == "child_database").find(x => x.child_database.title == "Committees By Semester")
  if (!commByYearBlock) {
    console.log("Could not find committee block.")
    return
  }

  const commByYearPages = await retrieveChildDatabase(commByYearBlock.id)
  if (!commByYearPages) {
    console.log("Failed to fetch child database.")
    return
  }

  // commByYearDatabase contains the pages (2025, 2026, etc) and we need to search
  // for the one the user queried.
  for (let i = 0; i < commByYearPages.length; i++) {
    const page = (await notion.pages.retrieve({
      page_id: commByYearPages[i].id
    }))
    if (!("properties" in page)) { continue }
    const name = page.properties.Name
    if (name.type != "title") { continue }
    if (name.title[0].plain_text != USER_YEAR_QUERY) { continue }
    committeePage = commByYearPages[i]
  }

  if (!committeePage) {
    console.log("Unable to find year as given.")
    return
  }

  // committeeTeamPages will contain the year's team and their roles
  const committeeTeamDatabases = (await retrieveBlockChildren(committeePage.id))
    .filter(x => x.type == "child_database")
  const database_team = committeeTeamDatabases.filter(x => x.child_database.title == "_team")[0]
  const database_metadata = committeeTeamDatabases.filter(x => x.child_database.title == "_rolemetadata")[0]
  
  if (!database_team || !database_metadata)  {
    console.log("Could not locate at least one of _team or _rolemetadata")
    return
  }

  const pages_team = await retrieveChildDatabase(database_team.id)
  if (!pages_team) {
    console.log("Failed to fetch committee team pages")
    return
  }

  const pages_metadata = await retrieveChildDatabase(database_metadata.id)
  if (!pages_metadata) {
    console.log("Failed to fetch committee team metadata")
    return
  }


  for (let i = 0; i < pages_metadata.length; i++) {
    const properties = pages_metadata[i].properties
    const name = properties.Name
    const index = properties.index

    if (name.type != "title") { continue }
    if (index.type != "number") { continue }
    if (!index.number) { continue }

    committeeMetadata[name.title[0].plain_text] = {_index: index.number, people: []}
  }

   for (let i = 0; i < pages_team.length; i++) {
    const properties = pages_team[i].properties
    const title = properties.Name
    const team = properties.team
    const role = properties.role
    const members = properties["Committee Members"]

    if (title.type != "title") { continue }
    if (team.type != "select") { continue }
    if (!team.select) { continue }
    if (role.type != "select") { continue }
    if (!role.select) { continue }
    if (members.type != "relation") { continue }
    if (!members) { continue }

    for (let j = 0; j < members.relation.length; j++) {
      const profile = await notion.pages.retrieve({ page_id: members.relation[j].id })
      if (!("properties" in profile)) { continue }

      const name = profile.properties.Name
      const portrait = profile.properties.Portrait
      if (portrait.type != "files") { continue }
      if (!portrait) { continue }
      const urlObj = portrait.files[0] || ""
      // The check below can fail occasionally, if somebody (looking at you Alex)
      // uploaded a file instead of a url to the page.
      // To fix this we upload the file to supabase then replace the file
      // with the supabase link
      if (urlObj.type != "external") { 
        // We can't deal with any other type yet, if there are any
        // Maybe replace with placeholder?
        if (urlObj.type != "file") {
          console.log("Unable to parse profile picture.")
          continue
        }

        const res = await fetch(urlObj.file.url)
        if (!res.ok) { console.log("Could not parse committee profile from Notion.") } 

        const arrayBuffer = await res.arrayBuffer()
        const fileBytes = new Uint8Array(arrayBuffer)

        // UPLOAD TO SUPABASE STORAGE HERE

        continue
      }
      
      if (name.type != "title") { continue }

      committeeMetadata[team.select.name].people.push({
        name: name.title[0].plain_text,
        img: urlObj.external.url,
        title: title.title[0].plain_text,
        order: role.select.name
      })
    }
  }

  const flatMetadata = Object.entries(committeeMetadata).map(x => {
    const y = x[1]
    y["role"] = x[0]
    return y
  })
  flatMetadata.sort((a,b) => a._index - b._index)

  for (let i = 0; i < flatMetadata.length; i++) {
    const subcommittee = flatMetadata[i]
    const officers = subcommittee.people.filter(x => x.order == "officer")
    const directors = subcommittee.people.filter(x => x.order == "director")
    htmlOutput += `<h1>${subcommittee.role}</h1>`
    // We assume only two layers for simplicity
    htmlOutput += `<div class="officers">`
    for (let j = 0; j < directors.length; j++) {
      htmlOutput += 
        `<div class="committee-member">
          <img src="${directors[j].img}">
          <h2>${directors[j].title}</h2>
          <h3>${directors[j].name}</h3>
        </div>`
    }
    htmlOutput += `</div><div class="officers">`
    for (let j = 0; j < officers.length; j++) {
      htmlOutput += 
      `<div class="committee-member">
          <img src="${officers[j].img}">
          <h2>${officers[j].title}</h2>
          <h3>${officers[j].name}</h3>
        </div>`
    }
    htmlOutput += `</div>`
  }

  console.log(htmlOutput)
})();
