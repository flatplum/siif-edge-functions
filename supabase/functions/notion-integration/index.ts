// The main entrypoint for the notion-integration edge function
// Copyright (C) 2025 flatplum

import { Client, iteratePaginatedAPI } from "npm:@notionhq/client";
import { PageObjectResponse, BlockObjectResponse } from "npm:@notionhq/client/build/src/api-endpoints";
import { createClient } from 'npm:@supabase/supabase-js@2'
import { md5 } from 'npm:hash-wasm'

const NOTION_INTEGRATION_KEY = Deno.env.get("NOTION_INTEGRATION_KEY")
const NOTION_DATABASE_ID = Deno.env.get("NOTION_DATABASE_ID")
const STORAGE_URL = Deno.env.get("STORAGE_URL")

// Initializing a client
// If we don't find a key, exit
if (!NOTION_INTEGRATION_KEY) {
  console.log("No integration key given.")
  process.exit(1); 
}

const notion = new Client({
  auth: NOTION_INTEGRATION_KEY
});

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


Deno.serve(async (req)=>{
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const USER_YEAR_QUERY = "2026 Summer"
  let htmlOutput: string = ""
  let committeeMetadata: committeeMetadataType = {}
  let committeePage: PageObjectResponse | undefined

  try {
    const storageResponse = await fetch(`${STORAGE_URL}/functions/committee.html`)

    if (storageResponse.ok) { 
      // File exists in storage, return it directly      
      return storageResponse    
    }

    // Now we execute rest of code
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
        let imgUrl = ""
        const profile = await notion.pages.retrieve({ page_id: members.relation[j].id })
        if (!("properties" in profile)) { continue }
  
        const name = profile.properties.Name
        if (name.type != "title") { continue }
        const plainName = name.title[0].plain_text

        const portrait = profile.properties.Portrait
        if (portrait.type != "files") { continue }
        if (!portrait) { continue }

        const urlObj = portrait.files[0] || ""
        // The check below can fail occasionally, if somebody (looking at you Alex)
        // uploaded a file instead of a url to the page.
        // To fix this we upload the file to supabase then replace the file
        // with the supabase link
        const getUrlObject = async (): Promise<string> => {
          let newFile = false
          let old_digest = ""
          const res = await fetch(urlObj.file.url)
          if (!res.ok) { console.log("Could not parse committee profile from Notion.") } 

          const arrayBuffer = await res.arrayBuffer()
          const fileBytes = new Uint8Array(arrayBuffer)
          const new_digest = await md5(fileBytes)

          // I really hope you have nicknames in brackets Alex!
          const supabaseFileName = plainName.split(" ").filter(x => x[0] != "(").join("")

          // Notion seems to serve their images as a jpeg
          // And wow do these variables have terrible names
          const contentType = res.headers.get('content-type') ?? "image/jpeg"
          const fileExt = contentType.split("/")[1]

          // Read existing file from storage at expected location, and then return hash
          const imageUrl = `${STORAGE_URL}/photos/committee/${supabaseFileName}.${fileExt}`
          const storageResponse = await fetch(imageUrl)
          if (!storageResponse.ok) { 
            newFile = true 
          } else {
            old_digest = await md5(new Uint8Array(await storageResponse.arrayBuffer()))
          }

          if (new_digest == old_digest) {
            console.log(`Identical file found for ${supabaseFileName}, upload unnecessary.`)
            return imageUrl
          } else {
            console.log(`Uploading for ${supabaseFileName}.`)
          }

          const { error } = await supabaseAdmin.storage
            .from('photos')
            [newFile ? "upload" : "update"](`committee/${supabaseFileName}.${fileExt}`, fileBytes, {
              contentType: contentType
            })

          if (error) {
            console.error('Upload failed:', error)
          }

          return imageUrl
        }

        if (urlObj.type != "external") { 
          // We can't deal with any other type yet, if there are any
          // Maybe replace with placeholder?
          if (urlObj.type != "file") {
            console.log("Unable to parse profile picture.")
            continue
          }

          imgUrl = await getUrlObject()
        } else {
          imgUrl = urlObj.external.url
        }
        
  
        committeeMetadata[team.select.name].people.push({
          name: plainName,
          img: imgUrl,
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
  
    // Upload to storage for future requests
    const { error } = await supabaseAdmin.storage
      .from('functions')
      .upload(`committee.html`, htmlOutput, {
        contentType: 'text/html',
        // I've chosen not to cache this for a few reasons:
        //   1. Supabase functions only trigger when someoneone visits the website
        //      and this would require a lengthy wait while everything loads
        //   2. That would also cause excess stress on Notion that I want to avoid
        //      if caches only last 24 hours
        //   3. It's much easier to trigger a refresh when we want, and we shouldn't be
        //      updating committees that often
        //   4. I wrote this at 4am for some of the messiest and worst annotated code ever,
        //      sue me
        // cacheControl: '86400',
      })

    if (error) {
      console.error('Upload failed:', error)
    }

    return new Response(htmlOutput, {
      headers: {
        'Content-Type': 'text/plain',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response('Error processing request', { status: 500 })
  }
});
