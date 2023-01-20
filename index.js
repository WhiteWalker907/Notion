const dotenv = require('dotenv');
const moment = require('moment');

dotenv.config();

const API_KEY = process.env.API_KEY;
const databaseId = process.env.NOTION_DATABASE_ID;

const sendPost = async (data) => {
    const { post, platforms, imageUrls, profileKeys, scheduleDate, shortenLinks } = data;

    const body = Object.assign({},
        post && { post },
        platforms && { platforms },
        profileKeys && { profileKeys: profileKeys.split(',').map(profileKey => profileKey.trim()) },
        Array.isArray(imageUrls) && imageUrls.length > 0 && { mediaUrls: imageUrls },
        scheduleDate && { scheduleDate },
        shortenLinks !== undefined && shortenLinks !== null && { shortenLinks }
    );

    console.log('Posting JSON:', JSON.stringify(body, null, 2));

    if (profileKeys) {
        body.profileKeys = profileKeys.split(",");
    }

    const response = await fetch('https://app.ayrshare.com/api/post', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        }
    }).then(res => res.json());

    return response;
};

const getPostsFromNotion = async () => {
    const pages = [];
    let cursor = undefined;
    const body = {
        filter: {
            property: 'Status',
            rich_text: {
                equals: 'pending'
            }
        }
    };

    while (true) {
        const { results, next_cursor } = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.NOTION_KEY}`,
                'Notion-Version': '2022-06-28'
            }
        }).then(res => res.json());
        pages.push(...results)
        if (!next_cursor) {
            break
        }
        cursor = next_cursor
    }
    console.log(`${pages.length} post(s) successfully fetched.`);

    const posts = []
    for (const page of pages) {
        const postId = page.properties['Post'].id;
        const platformsId = page.properties['Platforms'].id;
        const imagesId = page.properties['Images'].id;
        const profileKeysId = page.properties['Profile Keys'].id;
        const scheduleDateId = page.properties['Schedule Date'].id
        const { properties } = await fetch(`https://api.notion.com/v1/pages/${page.id}?filter_properties=${postId}&filter_properties=${platformsId}&filter_properties=${imagesId}&filter_properties=${profileKeysId}&filter_properties=${scheduleDateId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.NOTION_KEY}`,
                'Notion-Version': '2022-06-28'
            }
        }).then(res => res.json());
        const post = properties.Post.title[0];
        const profileKeys = properties['Profile Keys'].rich_text[0];
        const scheduleDate = properties['Schedule Date'].date
        posts.push({
            pageId: page.id,
            ...(post && { post: post.plain_text }),
            platforms: properties.Platforms.multi_select.map(multiSelect => multiSelect.name),
            imageUrls: properties.Images.files.map(file => file.file.url),
            ...(profileKeys && { profileKeys: profileKeys.plain_text }),
            ...(scheduleDate && { scheduleDate: moment(JSON.stringify(scheduleDate.start), 'YYY-MM-DDTHH:mm:ssZ').toISOString() })
        });
    }

    return posts;
}


const makePostsFromNotion = async () => {
    const posts = await getPostsFromNotion();
    for (let post of posts) {

        const shortenLinks = false;
        const response = await sendPost({ ...post, shortenLinks });

        if (response) {
            let status;
            if (Array.isArray(response)) {
                status = response.map(x => x.status).every(x => x === "success") ? "success" : "error";
            } else {
                status = response.status;
            }
            if (status === 'error') {
                console.error(JSON.stringify(response));
            }

            const body = { 
                properties: 
                    { Status: 
                        { rich_text: 
                            [{ text: { content: status } }] 
                        } 
                    } 
                };
            await fetch(`https://api.notion.com/v1/pages/${post.pageId}`, {
                method: 'PATCH',
                body: JSON.stringify(body),
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.NOTION_KEY}`,
                    'Notion-Version': '2022-06-28'
                }
            });
        }
    }
}

makePostsFromNotion();